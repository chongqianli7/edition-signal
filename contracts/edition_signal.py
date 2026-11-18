# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import date, timedelta
import json
import re

ROOT = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/"
DESKS = ("Science", "Culture", "Places", "Technology")


class EditionSignal(gl.Contract):
    editions: TreeMap[str, str]

    def __init__(self):
        pass

    def _load(self, key: str) -> dict:
        if key not in self.editions:
            raise gl.vm.UserError("EDITION_NOT_FOUND")
        return json.loads(self.editions[key])

    def _save(self, key: str, record: dict) -> None:
        self.editions[key] = json.dumps(record, separators=(",", ":"))

    @gl.public.view
    def edition(self, key: str) -> str:
        return self.editions[key] if key in self.editions else ""

    @gl.public.write
    def freeze(self, key: str, start: str, slots: u32, slate: str) -> None:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,39}", key) or key in self.editions:
            raise gl.vm.UserError("INVALID_OR_USED_KEY")
        if len(slate) > 1000 or not re.fullmatch(r"20[1-9][0-9]-[0-9]{2}-[0-9]{2}", start):
            raise gl.vm.UserError("INVALID_EDITION")
        try:
            first = date.fromisoformat(start)
            entries = json.loads(slate)
        except (TypeError, ValueError):
            raise gl.vm.UserError("INVALID_EDITION")
        if first < date(2015, 7, 1) or not isinstance(entries, list) or not 2 <= len(entries) <= 6 or not 1 <= int(slots) <= min(4, len(entries)):
            raise gl.vm.UserError("INVALID_EDITION")
        rows = []
        seen = set()
        for entry in entries:
            if not isinstance(entry, list) or len(entry) != 2:
                raise gl.vm.UserError("INVALID_CANDIDATE")
            title, desk = entry
            if desk not in DESKS or not isinstance(title, str) or not re.fullmatch(r"[A-Z0-9][A-Za-z0-9_()-]{0,79}", title):
                raise gl.vm.UserError("INVALID_CANDIDATE")
            if title.lower() in seen:
                raise gl.vm.UserError("DUPLICATE_CANDIDATE")
            seen.add(title.lower())
            rows.append({"title": title, "desk": desk, "status": "PENDING", "daily": [], "observer": ""})
        days = [(first + timedelta(days=i)).strftime("%Y%m%d") for i in range(14)]
        self._save(key, {"owner": str(gl.message.sender_address).lower(), "state": "FROZEN",
                         "days": days, "slots": int(slots), "rows": rows, "order": []})

    @gl.public.write
    def measure(self, key: str, index: u32) -> None:
        edition = self._load(key)
        if edition["state"] != "FROZEN":
            raise gl.vm.UserError("EDITION_PUBLISHED")
        if index >= len(edition["rows"]):
            raise gl.vm.UserError("INVALID_INDEX")
        row = edition["rows"][int(index)]
        if row["status"] == "MEASURED":
            raise gl.vm.UserError("ALREADY_MEASURED")
        title = row["title"]
        days = edition["days"]
        source = ROOT + title + "/daily/" + days[0] + "/" + days[-1]

        def observe() -> str:
            try:
                response = gl.nondet.web.get(source)
                if response.status == 404:
                    return "NO_SERIES"
                if response.status != 200:
                    return "HTTP_" + str(response.status)
                if len(response.body) > 16000:
                    return "INVALID_SERIES"
                items = json.loads(response.body.decode("utf-8"))["items"]
                found = {}
                for item in items:
                    day = item["timestamp"]
                    views = item["views"]
                    if (day in found or item["article"] != title or item["project"] != "en.wikipedia"
                            or item["access"] != "all-access" or item["agent"] != "user" or item["granularity"] != "daily"
                            or type(views) is not int or not 0 <= views <= 1000000000):
                        return "INVALID_SERIES"
                    found[day] = views
                if sorted(found) != [day + "00" for day in days]:
                    return "INCOMPLETE_SERIES"
                return json.dumps([found[day + "00"] for day in days], separators=(",", ":"))
            except Exception:
                return "SOURCE_UNAVAILABLE"

        result = gl.eq_principle.strict_eq(observe)
        if result == "NO_SERIES":
            row["status"] = "NO_SERIES"
        elif result.startswith("["):
            row["status"] = "MEASURED"
            row["daily"] = json.loads(result)
        else:
            raise gl.vm.UserError(result)
        row["observer"] = str(gl.message.sender_address).lower()
        row["source"] = source
        self._save(key, edition)

    @gl.public.write
    def publish(self, key: str) -> None:
        edition = self._load(key)
        if edition["owner"] != str(gl.message.sender_address).lower():
            raise gl.vm.UserError("CURATOR_REQUIRED")
        if edition["state"] != "FROZEN":
            raise gl.vm.UserError("EDITION_PUBLISHED")
        if any(row["status"] == "PENDING" for row in edition["rows"]):
            raise gl.vm.UserError("OBSERVATIONS_PENDING")
        ranked = []
        for i, row in enumerate(edition["rows"]):
            daily = row["daily"]
            if daily:
                row["baseline"] = sum(daily[:7])
                row["recent"] = sum(daily[7:])
                row["lift_bps"] = 10000 * (row["recent"] - row["baseline"]) // max(row["baseline"], 1)
                if row["baseline"] >= 100:
                    ranked.append(i)
                    continue
                row["decision"] = "LOW_BASELINE"
            else:
                row["decision"] = "NO_SERIES"
        ranked.sort(key=lambda i: (-edition["rows"][i]["lift_bps"], -edition["rows"][i]["recent"], edition["rows"][i]["title"]))
        desks = set()
        for i in ranked:
            row = edition["rows"][i]
            if row["desk"] in desks:
                row["decision"] = "DESK_LIMIT"
            elif len(edition["order"]) == edition["slots"]:
                row["decision"] = "SLOT_LIMIT"
            else:
                row["decision"] = "SELECTED"
                edition["order"].append(i)
                desks.add(row["desk"])
        if not edition["order"]:
            raise gl.vm.UserError("NO_ELIGIBLE_STORY")
        edition["state"] = "PUBLISHED"
        self._save(key, edition)
