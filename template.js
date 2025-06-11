const BigQuery = require('BigQuery');
const encodeUriComponent = require('encodeUriComponent');
const getAllEventData = require('getAllEventData');
const getContainerVersion = require('getContainerVersion');
const getCookieValues = require('getCookieValues');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
const makeString = require('makeString');
const Object = require('Object');
const parseUrl = require('parseUrl');
const Promise = require('Promise');
const sendHttpGet = require('sendHttpGet');
const sendHttpRequest = require('sendHttpRequest');
const sendPixelFromBrowser = require('sendPixelFromBrowser');
const setCookie = require('setCookie');
const sha256Sync = require('sha256Sync');

/*==============================================================================
==============================================================================*/

const traceId = getRequestHeader('trace-id');

const eventData = getAllEventData();

const useOptimisticScenario = isUIFieldTrue(data.useOptimisticScenario);

if (!isConsentGivenOrNotRequired()) {
  return data.gtmOnSuccess();
}

const url = eventData.page_location || getRequestHeader('referer');
if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
  return data.gtmOnSuccess();
}

fetchAIPToken(data, eventData).then((aipToken) => {
  sendEventRequests(data, eventData, aipToken);
});

if (useOptimisticScenario) {
  return data.gtmOnSuccess();
}

/*==============================================================================
  Vendor related functions
==============================================================================*/

function mapEvent(data, eventData) {
  let mappedData = {
    event: mapEventName(data, eventData),
    eventSource: 'gtm-server-side',
    ts: getTimestampMillis()
  };

  mappedData = addGDPRData(data, mappedData);
  mappedData = addMeasurementToken(data, mappedData);
  mappedData = addEventDetailsData(data, eventData, mappedData);

  return mappedData;
}

function mapEventName(data, eventData) {
  if (data.eventType === 'inherit') {
    const eventName = eventData.event_name;

    const gaToEventName = {
      page_view: 'PageView',
      'gtm.dom': 'PageView',
      sign_up: 'Signup',
      generate_lead: 'Lead',
      search: 'Search',
      view_search_results: 'Search',
      add_to_cart: 'AddToShoppingCart',
      begin_checkout: 'Checkout',
      purchase: 'Off-AmazonPurchases'
    };

    if (gaToEventName[eventName]) {
      return gaToEventName[eventName];
    }

    return eventName;
  }

  return data.eventType === 'standard' ? data.eventNameStandard : data.eventNameCustom;
}

function addGDPRData(data, mappedData) {
  if (isValidValue(data.gdpr)) mappedData.gdpr = makeInteger(data.gdpr);
  if (isValidValue(data.gdprPd)) mappedData.gdpr_pd = makeInteger(data.gdprPd);
  if (data.gdprTCFConsentString) mappedData.gdpr_consent = data.gdprTCFConsentString;

  return mappedData;
}

function measurementTokenCookieToTimestampPairsArray(measurementTokenCookie) {
  if (!measurementTokenCookie) return [];
  return measurementTokenCookie.split('|').map((tokenTsPair) => {
    const parts = tokenTsPair.split('.');
    const token = parts[0];
    const timestamp = parts[1];
    return [token, makeInteger(timestamp)];
  });
}

function measurementTokenTimestampPairsArrayToCookie(measurementTokenTimestampPairs) {
  return measurementTokenTimestampPairs.map((pair) => pair.join('.')).join('|');
}

function getMeasurementTokenArray() {
  const measurementToken = getCookieValues('amznAref')[0];
  if (!measurementToken) return;
  const measurementTokenArray = measurementTokenCookieToTimestampPairsArray(measurementToken);
  return measurementTokenArray.length > 0 ? measurementTokenArray : undefined;
}

function removeAnyExpiredMeasurementTokens(data, tokens, measurementTokenTTL) {
  if (!tokens) return;

  const canSetMeasurementTokenCookie = !isUIFieldTrue(data.notSetMeasurementTokenCookie);

  const expiredTokensCutoffTimestamp = getTimestampMillis() - measurementTokenTTL;
  const unexpiredMeasurementTokens = tokens.filter(
    (pair) => pair[1] > expiredTokensCutoffTimestamp
  );

  if (canSetMeasurementTokenCookie) {
    const containsOnlyExpiredMeasurementTokens = unexpiredMeasurementTokens.length === 0;
    if (containsOnlyExpiredMeasurementTokens) {
      setCookieValue('amznAref', '', 0);
      return;
    }

    const containsOnlyUnexpiredMeasurementTokens =
      unexpiredMeasurementTokens.length === tokens.length;
    if (!containsOnlyUnexpiredMeasurementTokens) {
      const newMeasurementTokenCookie = measurementTokenTimestampPairsArrayToCookie(
        unexpiredMeasurementTokens
      );
      const newMeasurementTokenCookieExpiration = makeInteger(
        (unexpiredMeasurementTokens[0][1] + measurementTokenTTL - getTimestampMillis()) / 1000
      );
      setCookieValue('amznAref', newMeasurementTokenCookie, newMeasurementTokenCookieExpiration);
    }
  }

  return unexpiredMeasurementTokens;
}

function handleMeasurementTokenFromURL(data, tokens, measurementTokenTTL) {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl || !parsedUrl.searchParams || !parsedUrl.searchParams.aref) return;

  const measurementTokenFromUrl = parsedUrl.searchParams.aref;

  const newMeasurementTokenTimestamp = getTimestampMillis();
  let updatedTokens = [[measurementTokenFromUrl, newMeasurementTokenTimestamp]].concat(
    tokens || []
  );

  const measurementTokenCookiePairsLimit = 147;
  if (updatedTokens.length >= measurementTokenCookiePairsLimit) {
    updatedTokens = updatedTokens.slice(0, measurementTokenCookiePairsLimit);
  }

  const newMeasurementTokenCookie = measurementTokenTimestampPairsArrayToCookie(updatedTokens);

  const canSetMeasurementTokenCookie = !isUIFieldTrue(data.notSetMeasurementTokenCookie);
  if (canSetMeasurementTokenCookie) {
    const newMeasurementTokenCookieExpiration = makeInteger(measurementTokenTTL / 1000);
    setCookieValue('amznAref', newMeasurementTokenCookie, newMeasurementTokenCookieExpiration);
  }

  return updatedTokens;
}

function addMeasurementToken(data, mappedData) {
  const measurementTokenTTL = 2592000000; // 30 days in milliseconds

  const existingTokens = getMeasurementTokenArray();

  const unexpiredTokens = removeAnyExpiredMeasurementTokens(
    data,
    existingTokens,
    measurementTokenTTL
  );

  if (data.tagRegion === 'NA') {
    const updatedTokens = handleMeasurementTokenFromURL(data, unexpiredTokens, measurementTokenTTL);

    if (updatedTokens)
      mappedData.arefs = measurementTokenTimestampPairsArrayToCookie(updatedTokens);
    else if (unexpiredTokens)
      mappedData.arefs = measurementTokenTimestampPairsArrayToCookie(unexpiredTokens);
  }

  return mappedData;
}

function addEventDetailsData(data, eventData, mappedData) {
  const eventParameters = {};

  if (eventData.currency) eventParameters.currencyCode = eventData.currency;

  if (isValidValue(eventData.value)) eventParameters.value = eventData.value;

  if (mappedData.event === 'Off-AmazonPurchase' && eventData.items && eventData.items[0]) {
    const unitsSold = eventData.items.reduce((acc, item) => (acc += makeInteger(item.quantity)), 0);
    if (unitsSold) eventParameters.unitsSold = unitsSold;
  }

  if (data.defaultAttributesList) {
    data.defaultAttributesList.forEach((d) => (eventParameters[d.name] = d.value));
  }

  if (mappedData.event === 'Off-AmazonPurchases' && data.offAmazonPurchasesAttributesList) {
    data.offAmazonPurchasesAttributesList.forEach((d) => (eventParameters[d.name] = d.value));
  }

  if (data.eventCustomAttributesList) {
    data.eventCustomAttributesList.forEach((d) => (eventParameters[d.name] = d.value));
  }

  mergeObj(mappedData, eventParameters);

  const matchId = data.hasOwnProperty('matchId') ? data.matchId : eventData.user_id;
  if (matchId) mappedData.MATCH_ID = matchId;

  return mappedData;
}

function getHashedRecords(data, eventData) {
  const eventDataUserData = eventData.user_data || {};
  const userData = {};

  let email =
    eventData.email ||
    eventData.email_address ||
    eventDataUserData.email ||
    eventDataUserData.email_address ||
    eventDataUserData.sha256_email_address;
  const emailType = getType(email);
  if (emailType === 'array' || emailType === 'object') email = email[0];

  let phone =
    eventData.phone ||
    eventData.phone_number ||
    eventDataUserData.phone ||
    eventDataUserData.phone_number ||
    eventDataUserData.sha256_phone_number;
  const phoneType = getType(phone);
  if (phoneType === 'array' || phoneType === 'object') phone = phone[0];

  if (email) userData.email = email;
  if (phone) userData.phonenumber = phone;

  if (data.userDataAttributesList) {
    data.userDataAttributesList.forEach((d) => {
      userData[d.name] = d.value;
    });
  }

  const hashedRecords = [];

  for (const key in userData) {
    let value = userData[key];
    if (!value) continue;

    if (key === 'phonenumber') value = normalizePhoneNumber(value);

    const hashedValue = hashData(value);
    if (!hashedValue) continue;

    hashedRecords.push({
      type: key,
      record: hashedValue
    });
  }

  return hashedRecords.length ? hashedRecords : undefined;
}

function getAmazonConsent(data, eventData) {
  const consentString = {
    geo: {},
    consent: {
      amazonConsentFormat: {}
    }
  };

  if (data.countryCode) consentString.geo.countryCode = data.countryCode;

  const ipAddress = data.hasOwnProperty('ipAddress') ? data.ipAddress : eventData.ip_override;
  if (ipAddress) consentString.geo.ipAddress = ipAddress;

  if (!data.amznAdStorage && !data.amznUserData && !data.gpp) {
    consentString.consent.amazonConsentFormat = {
      amzn_ad_storage: 'GRANTED',
      amzn_user_data: 'GRANTED'
    };
  }

  if (data.amznAdStorage) {
    consentString.consent.amazonConsentFormat.amzn_ad_storage = data.amznAdStorage;
  }
  if (data.amznUserData) {
    consentString.consent.amazonConsentFormat.amzn_user_data = data.amznUserData;
  }

  if (data.gpp) consentString.consent.gpp = data.gpp;

  return consentString;
}

function buildAIPTokenConfig(data, eventData) {
  const hashedRecords = getHashedRecords(data, eventData);
  if (!hashedRecords) return;

  const tokenConfig = {
    gdpr: 0, // 1: true, 0: false (default) - GDPR is mandatory for EU region token request.
    gdprConsent: '', // Valid IAB consent string, v1 or v2 (required if `gdpr` is 1)
    hashedRecords: hashedRecords,
    ttl: data.aipTokenCookieTTL ? makeInteger(data.aipTokenCookieTTL) : 9600 // In seconds
  };

  if (isValidValue(data.gdpr)) tokenConfig.gdpr = makeInteger(data.gdpr) === 1 ? 1 : 0;
  if (data.gdprTCFConsentString) tokenConfig.gdprConsent = data.gdprTCFConsentString;

  tokenConfig.amazonConsentString = getAmazonConsent(data, eventData);

  if (tokenConfig.gdpr && !tokenConfig.gdprConsent) {
    log({
      Name: 'Amazon',
      Type: 'Message',
      TraceId: traceId,
      EventName: 'AIP Token Request',
      Message: 'Request was not sent.',
      Reason: 'If GDPR consent is enabled, the TCFv2 consent string must be set.'
    });
    return data.gtmOnFailure();
  }

  return tokenConfig;
}

function setAIPCookie(aipTokenData) {
  setCookieValue('aatToken', aipTokenData.aipToken, aipTokenData.tokenMaxAge);
  return aipTokenData.aipToken;
}

function fetchAIPToken(data, eventData) {
  if (!isUIFieldTrue(data.enableAdvancedMatching)) {
    return Promise.create((resolve, reject) => resolve(undefined));
  }

  const existingAIPToken = getCookieValues('aatToken')[0];
  if (existingAIPToken) {
    return Promise.create((resolve, reject) => resolve(existingAIPToken));
  }

  const tokenConfig = buildAIPTokenConfig(data, eventData);
  if (!tokenConfig) {
    return Promise.create((resolve, reject) => resolve(undefined));
  }

  const requestUrl = 'https://tk.amazon-adsystem.com/envelope';
  log({
    Name: 'Amazon',
    Type: 'Request',
    TraceId: traceId,
    EventName: 'AIP Token Request',
    RequestMethod: 'POST',
    RequestUrl: requestUrl,
    RequestBody: tokenConfig
  });

  return sendHttpRequest(
    requestUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    JSON.stringify(tokenConfig)
  )
    .then((result) => {
      log({
        Name: 'Amazon',
        Type: 'Response',
        TraceId: traceId,
        EventName: 'AIP Token Request',
        ResponseStatusCode: result.statusCode,
        ResponseHeaders: result.headers,
        ResponseBody: result.body
      });

      if (result.statusCode >= 200 && result.statusCode < 300 && result.body) {
        let parsedBody;
        parsedBody = JSON.parse(result.body);

        if (getType(parsedBody) === 'object' && parsedBody.AIPToken) {
          setAIPCookie({
            aipToken: parsedBody.AIPToken,
            tokenMaxAge:
              makeInteger((makeInteger(parsedBody.cookieExpiry) - getTimestampMillis()) / 1000) ||
              makeInteger(data.aipTokenCookieTTL) ||
              9600
          });
          return parsedBody.AIPToken;
        }
      }
    })
    .catch((result) => {
      log({
        Name: 'Amazon',
        Type: 'Message',
        TraceId: traceId,
        EventName: 'AIP Token Request',
        Message: 'Request failed or timed out.',
        Reason: JSON.stringify(result)
      });
    });
}

function getRequestBaseUrl(data) {
  const baseUrls = {
    NA: 'https://s.amazon-adsystem.com/iu3',
    EU: 'https://aax-eu.amazon-adsystem.com/s/iu3',
    FE: 'https://aax-fe.amazon-adsystem.com/s/iu3'
  };

  return baseUrls[data.tagRegion];
}

function validateParameterName(parameter, mappedData) {
  const maxLength = 256;
  const isParameterValid = parameter.length <= maxLength;

  if (isParameterValid) return true;

  log({
    Name: 'Amazon',
    Type: 'Message',
    TraceId: traceId,
    EventName: mappedData.event,
    Message: 'Request was not sent.',
    Reason: 'Parameter "' + parameter + '" is invalid: length greater than ' + maxLength
  });

  return false;
}

function validateParameterValue(parameterValue, mappedData) {
  const maxLength = 1000;
  const isParameterValueValid = parameterValue.length <= maxLength;

  if (isParameterValueValid) return true;

  log({
    Name: 'Amazon',
    Type: 'Message',
    TraceId: traceId,
    EventName: mappedData.event,
    Message: 'Request was not sent.',
    Reason: 'Parameter value "' + parameterValue + '" is invalid: length greater than ' + maxLength
  });

  return false;
}

function getRequestUrlParameters(mappedData) {
  const requestParametersList = [];
  const reportingAttributesOnlyAlphanumericValues = [
    'brand',
    'category',
    'productid',
    'attr1',
    'attr2',
    'attr3',
    'attr4',
    'attr5',
    'attr6',
    'attr7',
    'attr8',
    'attr9',
    'attr10'
  ];
  const noValidateAttributes = ['gdpr', 'gdpr_pd', 'gdpr_consent', 'amznToken', 'arefs'];

  for (const key in mappedData) {
    let value = mappedData[key];
    if (!isValidValue(value)) continue;

    const valueType = getType(value);
    if (valueType === 'array' || valueType === 'object') value = JSON.stringify(value);
    else value = makeString(value);

    const shouldValidateAttribute = noValidateAttributes.indexOf(key) === -1;
    if (shouldValidateAttribute) {
      const isValidParameterName = validateParameterName(key, mappedData);
      if (!isValidParameterName) return null;

      let isValidParameterValue;
      if (key === 'event') {
        isValidParameterValue = validateParameterName(value, mappedData);
      } else {
        if (reportingAttributesOnlyAlphanumericValues.indexOf(key) !== -1) {
          value = replaceNonAlphanumeric(value);
        }
        isValidParameterValue = validateParameterValue(value, mappedData);
      }

      if (!isValidParameterValue) return null;
    }

    requestParametersList.push(enc(key) + '=' + enc(value));
  }

  return requestParametersList.join('&');
}

function trackEvent(mappedData, requestUrl) {
  log({
    Name: 'Amazon',
    Type: 'Request',
    TraceId: traceId,
    EventName: mappedData.event,
    RequestMethod: 'GET',
    RequestUrl: requestUrl
  });

  return sendHttpGet(requestUrl).then((result) => {
    if (result.statusCode >= 300 && result.statusCode < 400) {
      // 3rd party cookie 'ad-id' sync
      sendPixelFromBrowser(result.headers.location);
    }

    return result;
  });
}

function sendEventRequests(data, eventData, aipToken) {
  const mappedData = mapEvent(data, eventData);
  if (aipToken) mappedData.amznToken = aipToken;

  const missingParameters = areThereRequiredParametersMissing(mappedData);
  if (missingParameters) {
    log({
      Name: 'Amazon',
      Type: 'Message',
      TraceId: traceId,
      EventName: mappedData.event,
      Message: 'Request was not sent.',
      Reason: 'One or more required properties are missing: ' + missingParameters.join(' or ')
    });

    return data.gtmOnFailure();
  }

  const requestBaseUrl = getRequestBaseUrl(data);
  const requestUrlParameters = getRequestUrlParameters(mappedData);
  if (!requestUrlParameters) {
    return data.gtmOnFailure();
  }

  const eventRequests = [];
  data.tagIdsList.forEach((tagId) => {
    const tagIdValue = tagId.value;
    if (!tagIdValue) return;
    const requestUrl = requestBaseUrl + '?pid=' + tagIdValue + '&' + requestUrlParameters;
    eventRequests.push(trackEvent(mappedData, requestUrl));
  });

  Promise.all(eventRequests)
    .then((results) => {
      let someRequestFailed = false;

      results.forEach((result) => {
        log({
          Name: 'Amazon',
          Type: 'Response',
          TraceId: traceId,
          EventName: mappedData.event,
          ResponseStatusCode: result.statusCode,
          ResponseHeaders: result.headers,
          ResponseBody: result.body
        });

        if (result.statusCode < 200 || result.statusCode >= 400) {
          someRequestFailed = true;
        }
      });

      if (!useOptimisticScenario) {
        if (someRequestFailed) data.gtmOnFailure();
        else data.gtmOnSuccess();
      }
    })
    .catch((result) => {
      log({
        Name: 'Amazon',
        Type: 'Message',
        TraceId: traceId,
        EventName: mappedData.event,
        Message: 'Some request may have failed or timed out.',
        Reason: JSON.stringify(result)
      });

      if (!useOptimisticScenario) data.gtmOnFailure();
    });
}

function areThereRequiredParametersMissing(requestData) {
  const requiredParameters = ['event'];

  const anyMissing = requiredParameters.some((p) => !isValidValue(requestData[p]));
  if (anyMissing) return requiredParameters;
}

/*==============================================================================
  Helpers
==============================================================================*/

function replaceNonAlphanumeric(input) {
  if (getType(input) !== 'string') return input;

  let result = '';
  let lastWasUnderscore = false;

  for (let i = 0; i < input.length; i++) {
    const char = input.charAt(i);
    const isAlphanumeric =
      (char >= '0' && char <= '9') || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');

    if (isAlphanumeric) {
      result += char;
      lastWasUnderscore = false;
    } else if (!lastWasUnderscore) {
      result += '_';
      lastWasUnderscore = true;
    }
  }

  return result;
}

function mergeObj(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key)) target[key] = source[key];
  }
  return target;
}

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return phoneNumber;
  return phoneNumber
    .split(' ')
    .join('')
    .split('-')
    .join('')
    .split('(')
    .join('')
    .split(')')
    .join('')
    .split('+')
    .join('');
}

function isHashed(value) {
  if (!value) return false;
  return makeString(value).match('^[A-Fa-f0-9]{64}$') !== null;
}

function hashData(value) {
  if (!value) return value;

  const type = getType(value);

  if (value === 'undefined' || value === 'null') return undefined;

  if (type === 'array') {
    return value.map((val) => hashData(val));
  }

  if (type === 'object') {
    return Object.keys(value).reduce((acc, val) => {
      acc[val] = hashData(value[val]);
      return acc;
    }, {});
  }

  if (isHashed(value)) return value;

  return sha256Sync(makeString(value).trim().toLowerCase(), {
    outputEncoding: 'hex'
  });
}

function isUIFieldTrue(field) {
  return [true, 'true'].indexOf(field) !== -1;
}

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '';
}

function enc(data) {
  if (data === undefined || data === null) data = '';
  return encodeUriComponent(makeString(data));
}

function setCookieValue(name, value, maxAge) {
  const overrideCookieSettings = isUIFieldTrue(data.overrideCookieSettings);
  setCookie(name, value, {
    domain: overrideCookieSettings ? data.cookieDomain : 'auto',
    sameSite: 'strict',
    path: '/',
    secure: true,
    httpOnly: overrideCookieSettings ? !!data.cookieHttpOnly : true,
    'max-age': maxAge
  });
}

function isConsentGivenOrNotRequired() {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
  return xGaGcs[2] === '1';
}

function log(rawDataToLog) {
  const logDestinationsHandlers = {};
  if (determinateIsLoggingEnabled()) logDestinationsHandlers.console = logConsole;
  if (determinateIsLoggingEnabledForBigQuery()) logDestinationsHandlers.bigQuery = logToBigQuery;

  const keyMappings = {
    // No transformation for Console is needed.
    bigQuery: {
      Name: 'tag_name',
      Type: 'type',
      TraceId: 'trace_id',
      EventName: 'event_name',
      RequestMethod: 'request_method',
      RequestUrl: 'request_url',
      RequestBody: 'request_body',
      ResponseStatusCode: 'response_status_code',
      ResponseHeaders: 'response_headers',
      ResponseBody: 'response_body'
    }
  };

  for (const logDestination in logDestinationsHandlers) {
    const handler = logDestinationsHandlers[logDestination];
    if (!handler) continue;

    const mapping = keyMappings[logDestination];
    const dataToLog = mapping ? {} : rawDataToLog;

    if (mapping) {
      for (const key in rawDataToLog) {
        const mappedKey = mapping[key] || key;
        dataToLog[mappedKey] = rawDataToLog[key];
      }
    }

    handler(dataToLog);
  }
}

function logConsole(dataToLog) {
  logToConsole(JSON.stringify(dataToLog));
}

function logToBigQuery(dataToLog) {
  const connectionInfo = {
    projectId: data.logBigQueryProjectId,
    datasetId: data.logBigQueryDatasetId,
    tableId: data.logBigQueryTableId
  };

  dataToLog.timestamp = getTimestampMillis();

  ['request_body', 'response_headers', 'response_body'].forEach((p) => {
    dataToLog[p] = JSON.stringify(dataToLog[p]);
  });

  const bigquery =
    getType(BigQuery) === 'function' ? BigQuery() /* Only during Unit Tests */ : BigQuery;
  bigquery.insert(connectionInfo, [dataToLog], { ignoreUnknownValues: true });
}

function determinateIsLoggingEnabled() {
  const containerVersion = getContainerVersion();
  const isDebug = !!(
    containerVersion &&
    (containerVersion.debugMode || containerVersion.previewMode)
  );

  if (!data.logType) {
    return isDebug;
  }

  if (data.logType === 'no') {
    return false;
  }

  if (data.logType === 'debug') {
    return isDebug;
  }

  return data.logType === 'always';
}

function determinateIsLoggingEnabledForBigQuery() {
  if (data.bigQueryLogType === 'no') return false;
  return data.bigQueryLogType === 'always';
}
