"""A busy archive can recover once; repeated failures remain visible."""

from unittest.mock import MagicMock, Mock

import pytest

from app.services import fits_download


@pytest.mark.parametrize("retry_after,delay", [("5", 5), ("9999", 5), ("bad", 1)])
def test_busy_response_is_closed_before_bounded_retry(monkeypatch, retry_after, delay):
    busy, recovered = MagicMock(), MagicMock()
    for response in (busy, recovered):
        response.__enter__.return_value = response
    busy.status_code, busy.headers = 503, {"Retry-After": retry_after}
    recovered.status_code = 200
    get = Mock(side_effect=[busy, recovered])
    monkeypatch.setattr(fits_download.requests, "get", get)

    def sleep(seconds):
        assert seconds == delay
        busy.__exit__.assert_called_once()

    monkeypatch.setattr(fits_download.time, "sleep", sleep)
    with fits_download.cutout_response("https://irsa.ipac.caltech.edu/") as response:
        assert response is recovered
    assert get.call_count == 2
    recovered.__exit__.assert_called_once()


def test_persistent_failure_stops_after_two_requests(monkeypatch):
    busy = MagicMock(status_code=503, headers={})
    busy.__enter__.return_value = busy
    get = Mock(return_value=busy)
    monkeypatch.setattr(fits_download.requests, "get", get)
    monkeypatch.setattr(fits_download.time, "sleep", Mock())
    with fits_download.cutout_response("https://irsa.ipac.caltech.edu/") as response:
        assert response.status_code == 503
    assert get.call_count == 2
