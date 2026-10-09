import json
from types import SimpleNamespace

from app.autonomous.agents.job_hunter import (
    ApifyMcpLinkedInJobCollector,
    JobHunterAgent,
    _format_listing_card,
    _strip_html,
)


def test_strip_html_removes_tags_and_collapses_whitespace() -> None:
    assert _strip_html("<p>Hello <b>SRE</b></p>\n\n<br/>team") == "Hello SRE team"


def test_listing_card_is_parseable_and_capped() -> None:
    card = _format_listing_card({"title": "SRE", "skills": list("abcdefg")})
    body = card.removeprefix(":::job-card\n").removesuffix("\n:::")

    payload = json.loads(body)
    assert payload["title"] == "SRE"
    assert payload["company"] == "Unknown company"
    assert len(payload["skills"]) == 5


def test_requested_count_reads_number_from_message() -> None:
    assert JobHunterAgent._requested_count("find me 3 new jobs") == 3


def test_listing_history_request_detection() -> None:
    assert JobHunterAgent._is_listing_history_request("show me the jobs you found today")
    assert not JobHunterAgent._is_listing_history_request("search for MLOps roles")


def test_daily_quota_resets_on_new_day_and_bad_json() -> None:
    today = "2026-10-05"
    assert JobHunterAgent._read_daily_quota(json.dumps({"date": today, "used": 4}), today)["used"] == 4
    assert JobHunterAgent._read_daily_quota(json.dumps({"date": "2026-10-04", "used": 4}), today)["used"] == 0
    assert JobHunterAgent._read_daily_quota("not json", today)["used"] == 0


def test_to_listing_filters_senior_roles_and_extracts_skills() -> None:
    collector = ApifyMcpLinkedInJobCollector.__new__(ApifyMcpLinkedInJobCollector)

    junior = collector._to_listing(
        {"id": "1", "title": "SRE", "description": "2+ years with Kubernetes and Python"}
    )
    senior = collector._to_listing({"id": "2", "title": "Staff SRE", "description": "15+ years"})
    missing_id = collector._to_listing({"title": "SRE"})

    assert junior is not None and junior["source_job_id"] == "1"
    assert senior is None
    assert missing_id is None


def test_job_items_reads_structured_and_text_results() -> None:
    structured = SimpleNamespace(structuredContent={"items": [{"id": "1", "title": "SRE"}]}, content=[])
    text = SimpleNamespace(
        structuredContent=None,
        content=[SimpleNamespace(type="text", text=json.dumps([{"id": "2", "title": "MLOps"}]))],
    )

    assert ApifyMcpLinkedInJobCollector._job_items(structured)[0]["id"] == "1"
    assert ApifyMcpLinkedInJobCollector._job_items(text)[0]["id"] == "2"


def test_placeholder_items_are_detected() -> None:
    assert ApifyMcpLinkedInJobCollector._is_placeholder_item({"id": "string", "title": "string"})
    assert not ApifyMcpLinkedInJobCollector._is_placeholder_item({"id": "1", "title": "SRE"})


def test_fit_score_parses_two_digit_and_spaced_ratings() -> None:
    parse = JobHunterAgent._parse_fit_score
    assert parse("10/10 - excellent match") == 10
    assert parse("7 / 10 - decent fit") == 7
    assert parse("Fit: 8/10 because of 5 years of Go") == 8
    assert parse("no rating given") == 5
