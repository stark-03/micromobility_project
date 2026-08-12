"""Configuration for the ML service.

The service holds NO database credentials by design (design.md §2): Express is
the only writer to MySQL, and everything this service needs arrives in the
request payload. That is what keeps it stateless and horizontally scalable.
"""

import os

# Shared secret on /internal/* routes. Express is the only permitted caller;
# the browser never talks to port 8000.
ML_INTERNAL_SECRET = os.environ.get("ML_INTERNAL_SECRET", "dev_only_secret")

SERVICE_NAME = "micromobility-ml"
SERVICE_VERSION = "0.1.0"
