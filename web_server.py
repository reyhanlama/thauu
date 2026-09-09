#!/usr/bin/env python3
"""Small local web UI server for City Map Poster Generator."""

from __future__ import annotations

import json
import hashlib
import math
import mimetypes
import os
import subprocess
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "webui"
POSTERS_DIR = ROOT_DIR / "posters"
PREVIEWS_DIR = ROOT_DIR / "cache" / "previews"
DOWNLOADS_DIR = ROOT_DIR / "cache" / "downloads"
THEMES_DIR = ROOT_DIR / "themes"
GENERATOR = ROOT_DIR / "create_map_poster.py"
MAP_CACHE_DIR = ROOT_DIR / "cache" / "map_api"

MAX_BODY_BYTES = 20_000
MAX_DISTANCE = 30_000
MAX_DIMENSION = 20.0
GOOGLE_PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
GOOGLE_PLACE_DETAILS_URL = "https://places.googleapis.com/v1"
PLACE_SEARCH_TYPES = [
    "locality",
    "sublocality",
    "neighborhood",
    "administrative_area_level_3",
]

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
MAP_USER_AGENT = "MapThis/1.0 (https://mapthis.xyz)"


def _load_local_env() -> None:
    for filename in (".env.local", ".env"):
        path = ROOT_DIR / filename
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_local_env()


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if length > MAX_BODY_BYTES:
        raise ValueError("Request is too large.")
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Request body must be valid JSON.") from exc
    if not isinstance(data, dict):
        raise ValueError("Request body must be a JSON object.")
    return data


def _available_themes() -> list[dict]:
    themes = []
    for path in sorted(THEMES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        themes.append(
            {
                "id": path.stem,
                "name": data.get("name", path.stem.replace("_", " ").title()),
                "description": data.get("description", ""),
                "bg": data.get("bg", "#f4f0ea"),
                "text": data.get("text", "#1f2933"),
                "road": data.get("road_primary", data.get("road_default", "#707070")),
                "water": data.get("water", "#9fb8c9"),
            }
        )
    return themes


def _poster_record(path: Path, base_url: str = "/posters") -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "url": f"{base_url}/{path.name}",
        "mtime": stat.st_mtime,
        "size": stat.st_size,
    }


def _recent_posters(limit: int = 18) -> list[dict]:
    if not POSTERS_DIR.exists():
        return []
    files = [
        path
        for path in POSTERS_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in {".png", ".svg", ".pdf"}
    ]
    files.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return [_poster_record(path) for path in files[:limit]]


def _clean_coordinate(value: object, field: str) -> str:
    cleaned = _clean_text(value, field, required=True)
    try:
        parsed = float(cleaned)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a decimal coordinate.") from exc
    if field == "latitude" and not -90 <= parsed <= 90:
        raise ValueError("latitude must be between -90 and 90.")
    if field == "longitude" and not -180 <= parsed <= 180:
        raise ValueError("longitude must be between -180 and 180.")
    return f"{parsed:.7f}".rstrip("0").rstrip(".")


def _reverse_cache_path(latitude: str, longitude: str) -> Path:
    safe_lat = latitude.replace("-", "m").replace(".", "_")
    safe_lon = longitude.replace("-", "m").replace(".", "_")
    return ROOT_DIR / "cache" / f"reverse_{safe_lat}_{safe_lon}.json"


def _place_from_address(address: dict, display_name: str) -> tuple[str, str]:
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality")
        or address.get("county")
        or address.get("state_district")
        or address.get("state")
        or display_name.split(",")[0].strip()
    )
    country = address.get("country") or "Unknown"
    return city or "Unknown", country


def _reverse_geocode(latitude: str, longitude: str) -> dict:
    cache_path = _reverse_cache_path(latitude, longitude)
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))

    try:
        from geopy.geocoders import Nominatim
    except ImportError as exc:
        raise ValueError("geopy is required for coordinate lookup. Start the server from .venv.") from exc

    geolocator = Nominatim(user_agent="city_map_poster_ui", timeout=10)
    time.sleep(1)
    location = geolocator.reverse((latitude, longitude), language="en", exactly_one=True)
    if not location:
        raise ValueError("Could not find a place for those coordinates.")

    raw = getattr(location, "raw", {}) or {}
    address = raw.get("address", {}) or {}
    display_name = getattr(location, "address", None) or raw.get("display_name", "")
    city, country = _place_from_address(address, display_name)
    payload = {
        "latitude": latitude,
        "longitude": longitude,
        "city": city,
        "country": country,
        "displayName": display_name,
        "address": address,
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(payload), encoding="utf-8")
    return payload


def _google_api_key() -> str:
    key = os.environ.get("GOOGLE_MAPS_API_KEY") or os.environ.get("GOOGLE_PLACES_API_KEY")
    if not key:
        raise ValueError("Set GOOGLE_MAPS_API_KEY before starting the server.")
    return key


def _google_request(url: str, *, method: str = "GET", payload: dict | None = None, field_mask: str) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url, data=body, method=method)
    request.add_header("Content-Type", "application/json")
    request.add_header("X-Goog-Api-Key", _google_api_key())
    request.add_header("X-Goog-FieldMask", field_mask)
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"Google Places request failed: {detail}") from exc
    except URLError as exc:
        raise ValueError(f"Google Places request failed: {exc.reason}") from exc


def _search_google_places(query: str) -> list[dict]:
    data = _google_request(
        GOOGLE_PLACES_AUTOCOMPLETE_URL,
        method="POST",
        field_mask=(
            "suggestions.placePrediction.place,"
            "suggestions.placePrediction.text,"
            "suggestions.placePrediction.structuredFormat,"
            "suggestions.placePrediction.types"
        ),
        payload={
            "input": query,
            "includedPrimaryTypes": PLACE_SEARCH_TYPES,
            "languageCode": "en",
        },
    )
    results = []
    for suggestion in data.get("suggestions", []):
        prediction = suggestion.get("placePrediction")
        if not prediction:
            continue
        structured = prediction.get("structuredFormat", {})
        main_text = structured.get("mainText", {}).get("text")
        secondary_text = structured.get("secondaryText", {}).get("text")
        text = prediction.get("text", {}).get("text") or main_text or ""
        results.append(
            {
                "place": prediction.get("place"),
                "label": text,
                "mainText": main_text or text,
                "secondaryText": secondary_text or "",
                "types": prediction.get("types", []),
            }
        )
    return results


def _address_component(components: list[dict], wanted: tuple[str, ...]) -> str | None:
    for component in components:
        types = set(component.get("types", []))
        if any(item in types for item in wanted):
            return component.get("longText") or component.get("shortText")
    return None


def _place_from_google(place_name: str) -> dict:
    if not place_name.startswith("places/"):
        raise ValueError("Invalid Google place id.")
    data = _google_request(
        f"{GOOGLE_PLACE_DETAILS_URL}/{place_name}",
        field_mask=(
            "id,displayName,formattedAddress,location,addressComponents,types,primaryType"
        ),
    )
    location = data.get("location") or {}
    latitude = location.get("latitude")
    longitude = location.get("longitude")
    if latitude is None or longitude is None:
        raise ValueError("Google Places did not return coordinates for that place.")

    components = data.get("addressComponents", [])
    display_name = data.get("formattedAddress") or data.get("displayName", {}).get("text", "")
    city = (
        _address_component(components, ("locality", "sublocality", "neighborhood", "administrative_area_level_3"))
        or data.get("displayName", {}).get("text")
        or display_name.split(",")[0].strip()
    )
    country = _address_component(components, ("country",)) or "Unknown"
    return {
        "latitude": _clean_coordinate(str(latitude), "latitude"),
        "longitude": _clean_coordinate(str(longitude), "longitude"),
        "city": city,
        "country": country,
        "displayName": display_name,
        "googlePlaceId": data.get("id"),
        "types": data.get("types", []),
        "primaryType": data.get("primaryType", ""),
    }


def _clean_text(value: object, field: str, *, required: bool = False) -> str | None:
    if value in (None, ""):
        if required:
            raise ValueError(f"{field} is required.")
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text.")
    cleaned = value.strip()
    if required and not cleaned:
        raise ValueError(f"{field} is required.")
    if len(cleaned) > 120:
        raise ValueError(f"{field} is too long.")
    return cleaned or None


def _clean_float(value: object, field: str, default: float) -> float:
    if value in (None, ""):
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a number.") from exc
    if parsed <= 0:
        raise ValueError(f"{field} must be greater than zero.")
    return min(parsed, MAX_DIMENSION)


def _clean_distance(value: object) -> int:
    if value in (None, ""):
        return 18_000
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("distance must be a whole number.") from exc
    if parsed < 1_000 or parsed > MAX_DISTANCE:
        raise ValueError(f"distance must be between 1000 and {MAX_DISTANCE} meters.")
    return parsed


def _clean_payload(payload: dict) -> list[str]:
    themes = {theme["id"] for theme in _available_themes()}
    latitude = _clean_text(payload.get("latitude"), "latitude")
    longitude = _clean_text(payload.get("longitude"), "longitude")
    if latitude or longitude:
        latitude = _clean_coordinate(latitude, "latitude")
        longitude = _clean_coordinate(longitude, "longitude")

    city = _clean_text(payload.get("city"), "city")
    country = _clean_text(payload.get("country"), "country")
    if (not city or not country) and latitude and longitude:
        place = _reverse_geocode(latitude, longitude)
        city = city or place["city"]
        country = country or place["country"]
    if not city or not country:
        raise ValueError("coordinates are required.")

    theme = _clean_text(payload.get("theme"), "theme") or "terracotta"

    args = [sys.executable, str(GENERATOR), "--city", city, "--country", country]

    all_themes = bool(payload.get("allThemes"))
    if all_themes:
        args.append("--all-themes")
    else:
        if theme not in themes:
            raise ValueError(f"Unknown theme: {theme}")
        args.extend(["--theme", theme])

    distance = _clean_distance(payload.get("distance"))
    width = _clean_float(payload.get("width"), "width", 12.0)
    height = _clean_float(payload.get("height"), "height", 16.0)
    output_format = _clean_text(payload.get("format"), "format") or "png"
    if output_format not in {"png", "svg", "pdf"}:
        raise ValueError("format must be png, svg, or pdf.")

    args.extend(["--distance", str(distance), "--width", str(width), "--height", str(height)])
    args.extend(["--format", output_format])

    optional_flags = [
        ("displayCity", "--display-city", "display city"),
        ("displayCountry", "--display-country", "display country"),
        ("countryLabel", "--country-label", "country label"),
        ("fontFamily", "--font-family", "font family"),
    ]
    for key, flag, field in optional_flags:
        cleaned = _clean_text(payload.get(key), field)
        if cleaned:
            args.extend([flag, cleaned])

    if latitude and longitude:
        args.extend(["--latitude", latitude, "--longitude", longitude])

    return args


def _api_cache_path(namespace: str, key: str) -> Path:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return MAP_CACHE_DIR / f"{namespace}_{digest}.json"


def _read_api_cache(namespace: str, key: str) -> dict | list | None:
    path = _api_cache_path(namespace, key)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_api_cache(namespace: str, key: str, payload: dict | list) -> None:
    MAP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _api_cache_path(namespace, key).write_text(json.dumps(payload), encoding="utf-8")


def _format_coordinate(value: float, positive: str, negative: str) -> str:
    return f"{abs(value):.4f}° {positive if value >= 0 else negative}"


def _nominatim_places(query: str, limit: int = 8) -> list[dict]:
    cache_key = query.casefold().strip()
    cached = _read_api_cache("search_v7", cache_key)
    if isinstance(cached, list):
        return cached

    raw_results = []
    for feature_type in (None, "state"):
        params = (
            f"q={quote(query)}&format=jsonv2&addressdetails=1&namedetails=1&limit={max(limit * 2, 16)}"
            f"{'&featuretype=' + feature_type if feature_type else ''}&accept-language=en"
        )
        request = Request(f"{NOMINATIM_SEARCH_URL}?{params}")
        request.add_header("User-Agent", MAP_USER_AGENT)
        request.add_header("Accept", "application/json")
        try:
            with urlopen(request, timeout=15) as response:
                raw_results.extend(json.loads(response.read().decode("utf-8")))
        except (HTTPError, URLError, TimeoutError) as exc:
            raise ValueError(f"Place search is temporarily unavailable: {exc}") from exc

    results = []
    seen_places = set()
    for item in raw_results:
        try:
            latitude = float(item["lat"])
            longitude = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        address = item.get("address") or {}
        address_type = str(item.get("addresstype") or "").casefold()
        state_types = {"state", "province", "region"}
        locality_types = {"suburb", "neighbourhood", "quarter", "city_district", "borough", "district", "residential"}
        allowed_types = state_types | locality_types | {"city", "town", "municipality", "village"}
        if address_type not in allowed_types:
            continue
        place_type = "STATE" if address_type in state_types else "LOCALITY" if address_type in locality_types else "CITY"
        city = (
            item.get("name")
            or address.get("neighbourhood")
            or address.get("suburb")
            or address.get("quarter")
            or address.get("city_district")
            or address.get("borough")
            or address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("municipality")
            or item.get("display_name", "Place").split(",")[0]
        )
        parent_city = address.get("city") or address.get("town") or address.get("village") or address.get("municipality") or ""
        country = address.get("country") or "Unknown"
        parent_label = f"{parent_city}, {country}" if place_type == "LOCALITY" and parent_city.casefold() != city.casefold() else country
        area = address.get("state") or address.get("province") or address.get("region") or ""
        district = address.get("state_district") or address.get("county") or address.get("district") or ""
        context_candidates = (
            [parent_city or district, area, country]
            if place_type == "LOCALITY"
            else [district, area, country]
            if place_type == "CITY"
            else [country]
        )
        context_parts = []
        seen_context = {city.casefold()}
        for part in context_candidates:
            key = str(part or "").strip().casefold()
            if not key or key in seen_context:
                continue
            seen_context.add(key)
            context_parts.append(str(part).strip())
        context_label = " · ".join(context_parts)
        identity = (city.casefold(), context_label.casefold(), place_type)
        if identity in seen_places:
            continue
        seen_places.add(identity)
        results.append(
            {
                "city": city,
                "country": country,
                "parentCity": parent_city,
                "parentLabel": parent_label,
                "contextLabel": context_label,
                "placeType": place_type,
                "placeId": f"{item.get('osm_type', 'place')}:{item.get('osm_id', latitude)}",
                "label": item.get("display_name") or f"{city}, {country}",
                "latNum": latitude,
                "lonNum": longitude,
                "lat": _format_coordinate(latitude, "N", "S"),
                "lon": _format_coordinate(longitude, "E", "W"),
                "boundingBox": item.get("boundingbox"),
            }
        )
    results = results[:limit]
    _write_api_cache("search_v7", cache_key, results)
    return results


def _overpass_geometry(latitude: float, longitude: float, radius: int) -> dict:
    radius = max(900, min(radius, 7000))
    cache_key = f"{latitude:.4f},{longitude:.4f},{radius}"
    cached = _read_api_cache("geometry_v2", cache_key)
    if isinstance(cached, dict):
        return cached
    fallback_cached = _read_api_cache("geometry", cache_key)

    lat_delta = radius / 111_320
    lon_delta = radius / max(35_000, 111_320 * math.cos(math.radians(latitude)))
    south, north = latitude - lat_delta, latitude + lat_delta
    west, east = longitude - lon_delta, longitude + lon_delta
    bbox = f"{south:.6f},{west:.6f},{north:.6f},{east:.6f}"
    query = (
        "[out:json][timeout:25];("
        f'way["highway"]({bbox});'
        f'way["railway"~"rail|light_rail|tram"]({bbox});'
        f'way["waterway"~"river|canal|stream"]({bbox});'
        f'way["natural"~"water|coastline"]({bbox});'
        f'relation["natural"="water"]({bbox});'
        ");out tags geom;"
    )
    request = Request(OVERPASS_URL, data=f"data={quote(query)}".encode("ascii"), method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    request.add_header("User-Agent", MAP_USER_AGENT)
    try:
        with urlopen(request, timeout=40) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as exc:
        if isinstance(fallback_cached, dict):
            return fallback_cached
        raise ValueError(f"Map geometry is temporarily unavailable: {exc}") from exc

    features = []
    for element in raw.get("elements", []):
        tags = element.get("tags") or {}
        geometry = element.get("geometry") or []
        coordinates = [
            [point.get("lon"), point.get("lat")]
            for point in geometry
            if isinstance(point.get("lon"), (int, float)) and isinstance(point.get("lat"), (int, float))
        ]
        if len(coordinates) < 2:
            continue
        if "highway" in tags:
            kind, feature_class = "road", tags.get("highway", "road")
        elif "railway" in tags:
            kind, feature_class = "rail", tags.get("railway", "rail")
        elif tags.get("natural") in {"water", "coastline"}:
            kind, feature_class = "water", tags.get("natural", "water")
        elif "waterway" in tags:
            kind, feature_class = "waterway", tags.get("waterway", "waterway")
        else:
            continue
        features.append({"kind": kind, "class": feature_class, "name": tags.get("name"), "coordinates": coordinates})

    priority = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}
    features.sort(key=lambda feature: priority.get(feature["class"], 10))
    payload = {
        "center": [longitude, latitude],
        "bounds": [west, south, east, north],
        "radius": radius,
        "attribution": "© OpenStreetMap contributors",
        "features": features[:3200],
    }
    _write_api_cache("geometry_v2", cache_key, payload)
    return payload


class PosterUIHandler(BaseHTTPRequestHandler):
    server_version = "MapToPosterUI/0.1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        attachment = "download=1" in parsed.query

        if path == "/api/themes":
            _json_response(self, HTTPStatus.OK, {"themes": _available_themes()})
            return

        if path == "/api/posters":
            _json_response(self, HTTPStatus.OK, {"posters": _recent_posters()})
            return

        if path == "/api/search":
            params = parse_qs(parsed.query)
            query = (params.get("q") or [""])[0].strip()
            if len(query) < 2:
                _json_response(self, HTTPStatus.OK, {"places": []})
                return
            try:
                places = _nominatim_places(query)
            except ValueError as exc:
                _json_response(self, HTTPStatus.BAD_GATEWAY, {"error": str(exc), "places": []})
                return
            _json_response(self, HTTPStatus.OK, {"places": places})
            return

        if path == "/api/map-data":
            params = parse_qs(parsed.query)
            try:
                latitude = float((params.get("lat") or [""])[0])
                longitude = float((params.get("lon") or [""])[0])
                radius = int((params.get("radius") or ["4200"])[0])
                if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                    raise ValueError("Coordinates are outside the world map.")
            except (TypeError, ValueError) as exc:
                _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            try:
                payload = _overpass_geometry(latitude, longitude, radius)
            except ValueError as exc:
                _json_response(self, HTTPStatus.BAD_GATEWAY, {"error": str(exc)})
                return
            _json_response(self, HTTPStatus.OK, payload)
            return

        if path.startswith("/posters/"):
            self._serve_file(POSTERS_DIR / Path(path).name, attachment=attachment)
            return

        if path.startswith("/previews/"):
            self._serve_file(PREVIEWS_DIR / Path(path).name, attachment=attachment)
            return

        if path.startswith("/downloads/"):
            self._serve_file(
                DOWNLOADS_DIR / Path(path).name,
                attachment=True,
            )
            return

        if path == "/":
            self._serve_file(WEB_DIR / "index.html")
            return

        self._serve_file(WEB_DIR / path.lstrip("/"))

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        attachment = "download=1" in parsed.query

        if path.startswith("/posters/"):
            self._serve_file(POSTERS_DIR / Path(path).name, attachment=attachment, include_body=False)
            return

        if path.startswith("/previews/"):
            self._serve_file(PREVIEWS_DIR / Path(path).name, attachment=attachment, include_body=False)
            return

        if path.startswith("/downloads/"):
            self._serve_file(DOWNLOADS_DIR / Path(path).name, attachment=True, include_body=False)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/place-search":
            self._handle_place_search()
            return

        if parsed.path == "/api/place-details":
            self._handle_place_details()
            return

        if parsed.path == "/api/resolve":
            self._handle_resolve()
            return

        if parsed.path != "/api/generate":
            _json_response(self, HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return

        try:
            payload = _read_json(self)
            args = _clean_payload(payload)
        except ValueError as exc:
            _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        before = {path.name for path in POSTERS_DIR.glob("*") if path.is_file()}
        env = os.environ.copy()
        env.setdefault("PYTHONUNBUFFERED", "1")
        env.setdefault("MPLCONFIGDIR", str(ROOT_DIR / "cache" / "matplotlib"))
        env.setdefault("XDG_CACHE_HOME", str(ROOT_DIR / "cache" / "xdg"))
        Path(env["MPLCONFIGDIR"]).mkdir(parents=True, exist_ok=True)
        Path(env["XDG_CACHE_HOME"]).mkdir(parents=True, exist_ok=True)

        try:
            result = subprocess.run(
                args,
                cwd=ROOT_DIR,
                env=env,
                text=True,
                capture_output=True,
                timeout=900,
                check=False,
            )
        except subprocess.TimeoutExpired:
            _json_response(self, HTTPStatus.REQUEST_TIMEOUT, {"error": "Generation timed out."})
            return

        after_files = [path for path in POSTERS_DIR.glob("*") if path.is_file()]
        created = [path for path in after_files if path.name not in before]
        created.sort(key=lambda item: item.stat().st_mtime, reverse=True)

        is_preview = bool(payload.get("preview"))
        is_download_only = bool(payload.get("downloadOnly"))
        base_url = "/posters"
        move_dir = None
        if is_preview:
            move_dir = PREVIEWS_DIR
            base_url = "/previews"
        elif is_download_only:
            move_dir = DOWNLOADS_DIR
            base_url = "/downloads"

        if move_dir and created:
            move_dir.mkdir(parents=True, exist_ok=True)
            moved = []
            for path in created:
                target = move_dir / path.name
                path.replace(target)
                moved.append(target)
            created = moved

        payload = {
            "ok": result.returncode == 0,
            "posters": [_poster_record(path, base_url) for path in created],
            "recent": _recent_posters(),
            "stdout": result.stdout[-6000:],
            "stderr": result.stderr[-6000:],
        }
        if result.returncode != 0:
            payload["error"] = "Poster generation failed."
            _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, payload)
            return

        _json_response(self, HTTPStatus.OK, payload)

    def _handle_resolve(self) -> None:
        try:
            payload = _read_json(self)
            latitude = _clean_coordinate(payload.get("latitude"), "latitude")
            longitude = _clean_coordinate(payload.get("longitude"), "longitude")
            place = _reverse_geocode(latitude, longitude)
        except ValueError as exc:
            _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        _json_response(self, HTTPStatus.OK, {"place": place})

    def _handle_place_search(self) -> None:
        try:
            payload = _read_json(self)
            query = _clean_text(payload.get("query"), "query", required=True)
            if len(query) < 2:
                _json_response(self, HTTPStatus.OK, {"predictions": []})
                return
            predictions = _search_google_places(query)
        except ValueError as exc:
            _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc), "predictions": []})
            return
        _json_response(self, HTTPStatus.OK, {"predictions": predictions})

    def _handle_place_details(self) -> None:
        try:
            payload = _read_json(self)
            place_name = _clean_text(payload.get("place"), "place", required=True)
            place = _place_from_google(place_name)
        except ValueError as exc:
            _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        _json_response(self, HTTPStatus.OK, {"place": place})

    def _serve_file(
        self,
        path: Path,
        *,
        attachment: bool = False,
        include_body: bool = True,
    ) -> None:
        try:
            resolved = path.resolve()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        allowed_roots = (
            WEB_DIR.resolve(),
            POSTERS_DIR.resolve(),
            PREVIEWS_DIR.resolve(),
            DOWNLOADS_DIR.resolve(),
        )
        if not any(resolved == root or root in resolved.parents for root in allowed_roots):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not resolved.exists() or not resolved.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        body = resolved.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if attachment:
            self.send_header("Content-Disposition", f'attachment; filename="{resolved.name}"')
        self.end_headers()
        if include_body:
            self.wfile.write(body)


def main() -> None:
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), PosterUIHandler)
    print(f"MapToPoster UI running at http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
