# Amazon Ads Tag for Google Tag Manager Server-Side

The **Amazon Ads Tag for GTM Server-Side** enables you to send conversion events from your server directly to Amazon Ads. This enhances the accuracy and reliability of measurement, even when browser-based tracking falls short. It supports multiple event types, advanced user identity enrichment, regional consent frameworks, and detailed logging to both Console and BigQuery.

## How to Use

1. Add the **Amazon CAPI Tag** to your Server GTM container from the Template Gallery or by importing the template file.
2. Set your **Tag ID(s)** — available under _Events Manager > View Tag Code_ in Amazon DSP.
3. Choose your **Region**:

- North & South America, Japan, Australia
- Europe

4. Choose how to define your **Event Name**:

- **Standard** — pick from predefined Amazon event names.
- **Inherit from client** — maps incoming GA4 events to Amazon's expected schema.
- **Custom** — provide your own custom event name.

5. Optionally add **Event Attributes**, including extra attributes specific to “Off-AmazonPurchases” events.
6. Enable **Advanced Matching** to securely send user identifiers and enrich attribution.
7. Use a **Match ID** to link interactions across sessions and platforms without exposing personal data.
8. Set up **Consent Configuration** using TCFv2.
9. Configure cookie behaviors (optional) for storing **Measurement Tokens** (`amznAref`).
10. Configure **3rd-party cookie syncing from the browser** for improved user matching.
11. Activate **Optimistic Scenario** if you want the tag to return success without waiting for the Amazon API response.
12. Enable **Logging** to Console and/or BigQuery for debugging and monitoring.

## Supported Event Name Setup Methods

### Standard

Pick from the following predefined events:

- `AddToShoppingCart`
- `Checkout`
- `Contact`
- `Lead`
- `PageView`
- `Search`
- `Signup`
- `Application`
- `Subscribe`
- `Off-AmazonPurchases`
- `Other`

### Inherit from Client

Automatically maps GA4 events to Amazon equivalents:

- `page_view`, `gtm.dom` → `PageView`
- `sign_up` → `Signup`
- `generate_lead` → `Lead`
- `search`, `view_search_results` → `Search`
- `add_to_cart` → `AddToShoppingCart`
- `begin_checkout` → `Checkout`
- `purchase` → `Off-AmazonPurchases`

### Custom

Provide your own custom event name.

## Required Fields

- **Tag ID(s)** — at least one tag ID must be configured.
- **Event Name** — must be provided via Standard, Inherit, or Custom method.

## Features

### Advanced Matching

Advanced Matching lets you enrich conversion data with user identifiers like **email addresses** and **phone numbers**, which are securely SHA256 hashed if not already hashed. These values are used to generate a **first-party cookie (`aatToken`)**, which is automatically stored and sent with future events for improved matching and attribution.

- **Email and Phone Support**: If available, pass the email or phone (preferably with country code, no symbols or spaces).
- **Token TTL**: Set the lifetime of the advanced matching token (up to 7 days).
- **Fallbacks**: If user data is not manually specified, it can be automatically inherited from `eventData`.

### Match ID

**Match ID** is a privacy-safe, advertiser-defined identifier that links user interactions across different sessions, devices, and even channels without exposing personally identifiable information (PII).

Ideal for:

- Brands with **strict internal privacy policies**.
- Businesses with **multi-step customer journeys**.
- Advertisers handling **offline or login-wall conversions**.

**How it works:**

- You set a persistent `Match ID` during an initial user interaction.
- This ID is mapped to the user in Amazon’s systems (via hashed PII or third-party cookies if available).
- Later, during a conversion event (e.g., purchase), the same `Match ID` is sent again via the event.
- Amazon matches the conversion to the earlier interaction, allowing for end-to-end attribution.

### Measurement Token Management (`amznAref`)

- Automatically stores and refreshes Amazon's `amznAref` cookie.
- Allows or suppresses cookie setting based on configuration.
- Tokens are managed with expiration policies and region-specific behavior.
- Only active in **NA** region (never sent or stored in **EU** region).

### 3rd-party cookie syncing from the browser

- Enable 3rd-party cookie syncing from the browser for improved user matching.
- This feature is unavailable if the **Use Optimistic Scenario** configuration is enabled.

## Useful links:

- [Step-by-step guide on how to configure Amazon tag](https://stape.io/blog/amazon-server-side-tracking-conversions-api)

## Open Source

The **Amazon Ads Tag for GTM Server-Side** is developed and maintained by the [Stape Team](https://stape.io/) under the Apache 2.0 license.
