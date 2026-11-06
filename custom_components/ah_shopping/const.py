"""Constants for Albert Heijn Shopping."""
from datetime import timedelta

from homeassistant.const import Platform

DOMAIN = "ah_shopping"
NAME = "Albert Heijn Shopping"
PLATFORMS = [Platform.SENSOR, Platform.TODO]

API_BASE_URL = "https://api.ah.nl"
LOGIN_BASE_URL = "https://login.ah.nl"
CLIENT_ID = "appie-ios"
CLIENT_VERSION = "9.28"
USER_AGENT = "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)"
APPLICATION = "AHWEBSHOP"

CONF_ACCESS_TOKEN = "access_token"
CONF_REFRESH_TOKEN = "refresh_token"
CONF_EXPIRES_AT = "expires_at"
CONF_MEMBER_ID = "member_id"

TOKEN_REFRESH_MARGIN = timedelta(minutes=5)
CONF_UPDATE_INTERVAL_MINUTES = "update_interval_minutes"
DEFAULT_UPDATE_INTERVAL_MINUTES = 5
MIN_UPDATE_INTERVAL_MINUTES = 1
MAX_UPDATE_INTERVAL_MINUTES = 60
UPDATE_INTERVAL = timedelta(minutes=DEFAULT_UPDATE_INTERVAL_MINUTES)

# This is deliberately the exact same proven authentication validation query
# used by Albert Heijn Delivery. Shopping-list availability is validated later
# by the coordinator and is not part of the login flow.
BASE_FULFILLMENTS_QUERY = """
query OrderFulfillments {
  orderFulfillments(status: OPEN) {
    result {
      orderId
      statusCode
      statusDescription
      shoppingType
      transactionCompleted
      modifiable
      delivery {
        status
        method
        slot {
          date
          dateDisplay
          timeDisplay
          startTime
          endTime
        }
      }
    }
  }
}
"""

# AH "Mijn lijst" is a single account-wide shopping-list v2 resource.
# Confirmed by current implementations against the live API in 2026.
SHOPPINGLIST_ITEMS_PATH = "/mobile-services/shoppinglist/v2/items"
SHOPPINGLIST_ITEMS_READ_PATH = f"{SHOPPINGLIST_ITEMS_PATH}?orderBy=userInput&orderByParam=0"

FRONTEND_URL_BASE = "/ah_shopping"
FRONTEND_MODULE_URL = f"{FRONTEND_URL_BASE}/ah-shopping-card.js?v=0.2.30"


NEXT_ORDER_FULFILLMENTS_QUERY = """
query OrderFulfillments {
  orderFulfillments(status: OPEN) {
    result {
      orderId
      statusCode
      statusDescription
      shoppingType
      transactionCompleted
      reopenable
      modifiable
      isAfterCutOff
      closingDateTime
      totalPrice {
        totalPrice {
          amount
        }
      }
      delivery {
        status
        method
        slot {
          date
          dateDisplay
          timeDisplay
          startTime
          endTime
        }
      }
    }
  }
}
"""
