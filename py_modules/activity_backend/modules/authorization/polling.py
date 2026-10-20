"""Pure device-grant polling cadence decisions."""

from dataclasses import dataclass

RATE_LIMIT_BACKOFF_SECONDS = 5
MAX_FAILURE_BACKOFF_SECONDS = 60


@dataclass(slots=True)
class PollingCadence:
    """Mutable cadence retained for one device authorization grant."""

    base_interval: int
    failure_backoff: int = 0
    message: str = ""

    def next_delay(self, remaining: float) -> float:
        """Return the next bounded polling delay."""
        return min(self.base_interval + self.failure_backoff, remaining)

    def slow_down(self) -> None:
        """Apply the device-flow slow-down interval."""
        self.base_interval += RATE_LIMIT_BACKOFF_SECONDS

    def rate_limit(self, retry_after_seconds: int) -> None:
        """Honor a server rate limit before the next poll."""
        self.base_interval = max(
            self.base_interval + RATE_LIMIT_BACKOFF_SECONDS,
            retry_after_seconds,
        )

    def reset_failure_backoff(self) -> None:
        """Forget transient transport failure delay after a non-5xx response."""
        self.failure_backoff = 0

    def increase_failure_backoff(self) -> None:
        """Exponentially increase transient failure delay within the cap."""
        self.failure_backoff = min(
            max(self.failure_backoff * 2, self.base_interval),
            MAX_FAILURE_BACKOFF_SECONDS,
        )
