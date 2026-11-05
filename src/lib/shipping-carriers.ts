import { z } from "zod";

import { crossesBorder, HS_CODE } from "./duties";

/**
 * Shipping carriers (D133): the carriers a store will be able to connect from Integrations, prepared before their
 * connections exist. A store saves its own agreement with a carrier here (customer number, API access; secrets are
 * encrypted and never shown again) so that the connection can switch on the day it is built; until then nothing is
 * sent to any carrier and nothing at checkout or in orders changes.
 *
 * This file is the contract for what comes next: the registry of carriers with what each needs and what is planned, the
 * checks on what a store saves, and `ShippingCarrierAdapter`, the one interface each connection will implement (rates,
 * pickup points, booking with labels, tracking). The fields each carrier needs are the usual ones for its API and are
 * confirmed against the carrier's own documentation when its connection is built; adding a field is a line here.
 * Pure types, checks and texts, shared by the browser and the server, which checks everything again.
 */

export type CarrierId = "bring" | "postnord" | "porterbuddy" | "helthjem" | "instabox" | "dhl" | "ups" | "dhl_paket" | "nshift" | "sendcloud";
export const CARRIER_IDS: CarrierId[] = ["bring", "postnord", "porterbuddy", "helthjem", "instabox", "dhl", "ups", "dhl_paket", "nshift", "sendcloud"];
export const isCarrierId = (value: string): value is CarrierId => (CARRIER_IDS as string[]).includes(value);

/**
 * The carriers whose parcels Kaizena Flow follows (D238): every carrier with a tracking call. Instabox is left out: Instabee's API reads an order by
 * its own order id, not by the parcel number a shipment keeps, so its parcels are followed on Instabox's own tracking page (the shipment's link).
 * Sendcloud books nothing yet (D483 step 1, the connection): it joins when its tracking is built.
 */
export const FOLLOWED_CARRIERS: CarrierId[] = CARRIER_IDS.filter((id) => id !== "instabox" && id !== "sendcloud");
export const isFollowedCarrier = (value: string): value is CarrierId => (FOLLOWED_CARRIERS as string[]).includes(value);

/** The countries a carrier that ships from anywhere in Europe delivers in (UPS, DHL Express, D458): the EU, the EEA, Switzerland and the UK. */
export const EUROPE: string[] = [
  "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL",
  "NO", "PL", "PT", "RO", "SE", "SI", "SK",
];

/** What a connection will do for the store, from the shopper's checkout to the parcel on its way. */
export type CarrierFeature = "rates" | "pickup_points" | "labels" | "tracking" | "time_windows" | "same_day" | "return_labels" | "collection" | "cancel";

export const CARRIER_FEATURE_LABELS: Record<CarrierFeature, string> = {
  rates: "Delivery options and prices at checkout",
  pickup_points: "Pickup points the shopper can choose",
  labels: "Book shipments and print labels from the order",
  tracking: "Tracking numbers on the order and in emails",
  time_windows: "Home delivery in a time window",
  same_day: "Same-day delivery",
  return_labels: "Return labels for customers",
  collection: "Collection of your parcels when you book",
  cancel: "Cancel a booking when a parcel is undone",
};

/** A detail the store gives the carrier's API: secret ones are encrypted and shown only as saved. */
export type CarrierField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
  placeholder?: string;
  /** A country code (ISO 3166-1 alpha-2): written in capitals and refused when it is not two letters. */
  format?: "country";
  /**
   * Chosen from a list the carrier gives once the store's keys are saved, never typed: `sender_address` is one of the sender
   * addresses of the store's own Sendcloud account (D454), kept as its id.
   */
  pick?: "sender_address";
};

export type CarrierInfo = {
  id: CarrierId;
  name: string;
  /** What it is, in a line. */
  summary: string;
  /** Countries the carrier delivers in, as the store's markets are named (ISO 3166-1 alpha-2). */
  countries: string[];
  /** Everything the connection will do. */
  features: CarrierFeature[];
  /** What works now: a carrier without any is still being prepared. */
  available: CarrierFeature[];
  /**
   * Its connection can be checked before any feature works (Sendcloud's first step, D454): the store saves its keys, checks them
   * and finishes its setup while labels, checkout and tracking are still being built.
   */
  checkable?: true;
  /** The countries the carrier books return labels in, from the shopper's address to the store's (D239); none without `return_labels`. */
  returnCountries?: string[];
  /** The sender countries the carrier collects from (D459), when it does not collect everywhere it books from. */
  collectionCountries?: string[];
  fields: CarrierField[];
  /** Where the store gets an agreement and API access. */
  docs: string;
  /** The steps to get ready, in words. */
  steps: string[];
};

export const CARRIERS: CarrierInfo[] = [
  {
    id: "bring",
    name: "Posten / Bring",
    summary: "Norway's postal service and Bring's parcels across the Nordics: home delivery, pickup points and the mailbox.",
    countries: ["NO", "SE", "DK", "FI"],
    features: ["rates", "pickup_points", "labels", "tracking", "return_labels"],
    available: ["rates", "pickup_points", "labels", "tracking", "return_labels"],
    // Bring's return service (9300, "Return Parcels Service") is documented for Norway; other countries' return products need confirmation (D239 1.2).
    returnCountries: ["NO"],
    fields: [
      { key: "customerNumber", label: "Customer number", secret: false, required: true, help: "Your number in your agreement with Posten / Bring." },
      { key: "apiUid", label: "Mybring API user", secret: false, required: true, help: "The user (email) of your Mybring API access." },
      { key: "apiKey", label: "Mybring API key", secret: true, required: true },
      { key: "senderName", label: "Sender name", secret: false, required: true, help: "Shown on the label: your business or shop." },
      { key: "senderStreet", label: "Sender street address", secret: false, required: true, help: "Where parcels are sent from." },
      { key: "senderPostalCode", label: "Sender postal code", secret: false, required: true },
      { key: "senderCity", label: "Sender city", secret: false, required: true },
      { key: "senderPhone", label: "Sender phone", secret: false, required: false, help: "Bring may use it if there is a problem with a pickup." },
    ],
    docs: "https://developer.bring.com",
    steps: [
      "Have an agreement with Posten / Bring and a Mybring account.",
      "In Mybring, open the API settings and create API access for this store.",
      "Copy the customer number, the API user and the API key to the form.",
    ],
  },
  {
    id: "postnord",
    name: "PostNord",
    summary: "Parcels and letters in Sweden, Denmark, Norway and Finland, with pickup points and tracking.",
    countries: ["SE", "DK", "NO", "FI"],
    features: ["rates", "pickup_points", "labels", "tracking", "return_labels", "collection"],
    available: ["rates", "pickup_points", "labels", "tracking", "return_labels", "collection"],
    returnCountries: ["SE", "DK", "NO", "FI"],
    // PostNord collects in Sweden, Denmark and Finland, not from a sender in Norway (its booking guide, D459).
    collectionCountries: ["SE", "DK", "FI"],
    fields: [
      { key: "customerNumber", label: "Customer number", secret: false, required: true, help: "Your number in your agreement with PostNord." },
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "applicationId", label: "Application id", secret: false, required: false, help: "PostNord gives one when you go live: ask apisupport@postnord.com. Not needed in the test environment.", placeholder: "1234" },
      { key: "senderName", label: "Sender name", secret: false, required: true, help: "Printed on the label: your business or shop." },
      { key: "senderStreet", label: "Sender street address", secret: false, required: true, help: "Where parcels are sent from." },
      { key: "senderPostalCode", label: "Sender postal code", secret: false, required: true },
      { key: "senderCity", label: "Sender city", secret: false, required: true },
      { key: "senderCountry", label: "Sender country", secret: false, required: true, help: "Where your PostNord agreement is: SE, DK, NO or FI.", placeholder: "SE", format: "country" },
      { key: "senderPhone", label: "Sender phone", secret: false, required: false, help: "PostNord's driver may call it about a collection." },
      { key: "senderEmail", label: "Sender email", secret: false, required: false, help: "PostNord sends collection confirmations here." },
      { key: "collectionHours", label: "Collection hours", secret: false, required: false, help: "When a courier can collect your parcels, written 10:00-17:00, to ask for a collection when you book. Leave it empty if you hand them in or have a standing collection.", placeholder: "10:00-17:00" },
    ],
    docs: "https://developer.postnord.com",
    steps: [
      "Have a customer agreement with PostNord.",
      "At PostNord's developer portal, make an application and get an API key for it.",
      "Copy the customer number and the API key to the form.",
      "Ask PostNord for an application id for live bookings (apisupport@postnord.com), and add the address your parcels are sent from.",
      "PostNord does not give prices through its API: you enter what you charge for each service from your agreement.",
    ],
  },
  {
    id: "porterbuddy",
    name: "Porterbuddy",
    summary: "Fast home delivery in a time window your shopper chooses, including the same day.",
    countries: ["NO"],
    features: ["rates", "labels", "tracking", "time_windows", "same_day"],
    available: ["rates", "labels", "tracking", "time_windows", "same_day"],
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, help: "From your profile in Porterbuddy's partner portal." },
      { key: "senderName", label: "Name for the pickup", secret: false, required: true, help: "Printed on the label and given to the courier: your shop's name." },
      { key: "senderStreet", label: "Pickup street and number", secret: false, required: true, help: "Where the courier collects the parcels, with the number: Keysers gate 3.", placeholder: "Keysers gate 3" },
      { key: "senderPostalCode", label: "Pickup postal code", secret: false, required: true },
      { key: "senderCity", label: "Pickup city", secret: false, required: true },
      { key: "senderEmail", label: "Pickup email", secret: false, required: true, help: "Porterbuddy sends the pickup notices here." },
      { key: "senderPhone", label: "Pickup phone", secret: false, required: true, help: "Who the courier can call, with the country code if it is not Norway." },
      { key: "pickupHours", label: "Parcels are ready between", secret: false, required: false, help: "Your opening hours, written 10:00-17:00. Porterbuddy offers delivery windows after these.", placeholder: "10:00-17:00" },
      { key: "pickupDays", label: "Days you hand over parcels", secret: false, required: false, help: "Weekdays as numbers, 1 is Monday and 7 Sunday: 1-5, or 1,2,3,4,6.", placeholder: "1-5" },
    ],
    docs: "https://developer.porterbuddy.com",
    steps: [
      "Have an agreement with Porterbuddy: register at porterbuddy.com/business (accounts are by invitation).",
      "In their partner portal, open your profile and copy the API key. Use the test portal's key for the test environment.",
      "Give the address and hours where the courier collects your parcels, so the delivery windows match when they are ready.",
      "Use the test environment until Porterbuddy has approved your setup. Test orders deliver nothing.",
    ],
  },
  {
    id: "helthjem",
    name: "Helthjem",
    summary: "Home delivery to the mailbox or doormat and delivery to service points across Norway, with labels and tracking.",
    countries: ["NO"],
    features: ["rates", "pickup_points", "labels", "tracking"],
    available: ["rates", "pickup_points", "labels", "tracking"],
    fields: [
      { key: "clientId", label: "Client ID", secret: false, required: true, help: "From Helthjem's integrations team, with your client secret." },
      { key: "clientSecret", label: "Client secret", secret: true, required: true },
      { key: "shopId", label: "Shop ID", secret: false, required: true, help: "Your shop's number in your agreement with Helthjem." },
      { key: "homeSolutionId", label: "Transport solution for home delivery", secret: false, required: true, help: "The number Helthjem gave you for delivery to the door. 2 only delivers to the door; 114 falls back to a service point where the door is not covered.", placeholder: "114" },
      { key: "collectSolutionId", label: "Transport solution for service points", secret: false, required: false, help: "The number for delivery to a service point, for example 86 (Helthjem's own) or 62 (with PostNord's as a fallback). Leave empty not to offer service points.", placeholder: "86" },
      { key: "senderName", label: "Sender name", secret: false, required: true, help: "Printed on the label: your shop's name." },
      { key: "senderStreet", label: "Sender street and number", secret: false, required: true, placeholder: "Akersgata 55" },
      { key: "senderPostalCode", label: "Sender postal code", secret: false, required: true },
      { key: "senderCity", label: "Sender city", secret: false, required: true },
      { key: "senderPhone", label: "Sender phone", secret: false, required: false },
    ],
    docs: "https://developer.helthjem.no",
    steps: [
      "Be a Helthjem customer: apply at helthjem.no/bli-kunde.",
      "Email integrations@helthjem.no for your client ID and secret, your shop ID and the transport solutions for your agreement.",
      "Copy them to the form, with the address your parcels are sent from.",
      "Use the test environment until Helthjem has approved your setup. Helthjem does not give prices through its API: you enter what you charge for each service at checkout.",
    ],
  },
  {
    id: "instabox",
    name: "Instabox",
    summary: "Parcel lockers in Sweden, Norway and Denmark, open around the clock, and home delivery: the shopper chooses at checkout and gets a code to open the locker.",
    countries: ["SE", "NO", "DK"],
    features: ["rates", "pickup_points", "labels", "tracking", "return_labels"],
    available: ["rates", "pickup_points", "labels", "tracking", "return_labels"],
    returnCountries: ["SE", "NO", "DK"],
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, help: "From your implementation manager at Instabee, for the Instabee API." },
      { key: "collectionPointId", label: "Warehouse id", secret: false, required: false, help: "Only when you send from more than one place: the id Instabee gave the warehouse this store sends from." },
    ],
    docs: "https://docs.integration.instabee.com",
    steps: [
      "Have an agreement with Instabee for Instabox lockers: apply at instabee.com.",
      "Ask your implementation manager for an API key for the Instabee API, one for the sandbox and one for live.",
      "Copy the key to the form. Instabee already knows the address your parcels are collected from.",
      "Use the test environment until Instabee has approved your setup. You enter what you charge for a locker or home delivery at checkout.",
    ],
  },
  {
    id: "dhl",
    name: "DHL Express",
    summary: "Express parcels across Europe and the world on your DHL Express account, to the door or a DHL ServicePoint, with prices, labels with customs papers, collection and tracking.",
    countries: EUROPE,
    features: ["rates", "pickup_points", "labels", "tracking", "collection"],
    available: ["rates", "pickup_points", "labels", "tracking", "collection"],
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, help: "The MyDHL API key (user name) DHL gave you." },
      { key: "apiSecret", label: "API secret", secret: true, required: true },
      { key: "accountNumber", label: "DHL Express account number", secret: false, required: true, help: "Your nine-digit DHL Express account (shipper) number.", placeholder: "123456789" },
      { key: "senderName", label: "Sender name", secret: false, required: true, help: "Printed on the label: your business or shop." },
      { key: "senderStreet", label: "Sender street address", secret: false, required: true },
      { key: "senderPostalCode", label: "Sender postal code", secret: false, required: true },
      { key: "senderCity", label: "Sender city", secret: false, required: true },
      { key: "senderCountry", label: "Sender country", secret: false, required: true, help: "The two-letter code of the country you send from, like NO, SE or DE.", placeholder: "NO", format: "country" },
      { key: "senderPhone", label: "Sender phone", secret: false, required: true, help: "DHL needs it on every shipment." },
      { key: "senderEmail", label: "Sender email", secret: false, required: false },
      { key: "collectionHours", label: "Collection hours", secret: false, required: false, help: "When a courier can collect your parcels, written 10:00-17:00, to ask for a collection when you book. Leave it empty if you hand them in or have a standing collection.", placeholder: "10:00-17:00" },
    ],
    docs: "https://developer.dhl.com/api-reference/dhl-express-mydhl-api",
    steps: [
      "Have a DHL Express account (a nine-digit account number).",
      "Ask your DHL Express contact for access to the MyDHL API: they send an API key and secret for the test environment, and for live when you are approved.",
      "Copy the key, the secret and the account number to the form, with the address your parcels are sent from.",
      "DHL gives its prices for each parcel: your shoppers pay them with VAT and what you add. Parcels to a country outside the EU's customs union carry customs papers from your products' HS codes and countries of origin.",
    ],
  },
  {
    id: "ups",
    name: "UPS",
    summary: "Parcels by road and air across Europe and the world on your UPS account, to the door or to a UPS Access Point, with labels and tracking.",
    countries: EUROPE,
    features: ["rates", "pickup_points", "labels", "tracking", "return_labels", "collection", "cancel"],
    available: ["rates", "pickup_points", "labels", "tracking", "return_labels", "collection", "cancel"],
    // A return within one country or between EU countries: UPS's connection refuses one across a customs border.
    returnCountries: EUROPE,
    fields: [
      { key: "clientId", label: "Client ID", secret: false, required: true, help: "From your app on UPS's developer portal (developer.ups.com), with its client secret." },
      { key: "clientSecret", label: "Client secret", secret: true, required: true },
      { key: "accountNumber", label: "UPS account number", secret: false, required: true, help: "Your six-character UPS account (shipper) number. Add it to the app on the developer portal too.", placeholder: "A1B2C3" },
      { key: "senderName", label: "Sender name", secret: false, required: true, help: "Printed on the label: your business or shop." },
      { key: "senderStreet", label: "Sender street address", secret: false, required: true },
      { key: "senderPostalCode", label: "Sender postal code", secret: false, required: true },
      { key: "senderCity", label: "Sender city", secret: false, required: true },
      { key: "senderCountry", label: "Sender country", secret: false, required: true, help: "The two-letter code of the country you send from, like NO, SE or DE.", placeholder: "NO", format: "country" },
      { key: "senderPhone", label: "Sender phone", secret: false, required: true, help: "UPS needs it on every shipment." },
      { key: "senderEmail", label: "Sender email", secret: false, required: false },
      { key: "collectionHours", label: "Collection hours", secret: false, required: false, help: "When a courier can collect your parcels, written 10:00-17:00, to ask for a collection when you book. Leave it empty if you hand them in or have a standing collection.", placeholder: "10:00-17:00" },
    ],
    docs: "https://developer.ups.com",
    steps: [
      "Have a UPS account (a six-character account number).",
      "Sign in at developer.ups.com, make an app with the Authorization, Rating, Shipping, Tracking, Locator and Pickup APIs, and add your account number to it.",
      "Copy the app's client ID and secret and your account number to the form, with the address your parcels are sent from.",
      "UPS gives its prices for each parcel, with your own rates when your account has them: your shoppers pay them with VAT and what you add.",
    ],
  },
  {
    id: "dhl_paket",
    name: "DHL Paket",
    summary: "Parcels from Germany on your DHL business customer account: to the door, as a small parcel or to a post office or Paketshop, with labels, returns and tracking.",
    countries: EUROPE,
    features: ["rates", "pickup_points", "labels", "tracking", "return_labels", "collection", "cancel"],
    available: ["rates", "pickup_points", "labels", "tracking", "return_labels", "collection", "cancel"],
    returnCountries: ["DE"],
    collectionCountries: ["DE"],
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, help: "The key of your app on DHL's developer portal (developer.dhl.com), with Parcel DE Shipping, Parcel DE Returns, Location Finder - Unified and Shipment Tracking - Unified added." },
      { key: "apiSecret", label: "API secret", secret: true, required: true },
      { key: "username", label: "Business Customer Portal user", secret: false, required: true, help: "A system user of the Post & DHL Business Customer Portal (geschaeftskunden.dhl.de) that may ship.", placeholder: "user-valid" },
      { key: "password", label: "Business Customer Portal password", secret: true, required: true },
      { key: "ekp", label: "EKP (customer number)", secret: false, required: true, help: "Your ten-digit DHL customer number.", placeholder: "1234567890" },
      { key: "participation", label: "Participation", secret: false, required: false, help: "The last two characters of your billing numbers (Teilnahme): 01 unless DHL gave you another.", placeholder: "01" },
      { key: "returnReceiverId", label: "Returns receiver", secret: false, required: false, help: "The returns receiver set up in the Business Customer Portal, for return labels: deu unless you named another.", placeholder: "deu" },
      { key: "profile", label: "User group profile", secret: false, required: false, placeholder: "STANDARD_GRUPPENPROFIL" },
      { key: "senderName", label: "Sender name", secret: false, required: true, help: "Printed on the label: your business or shop." },
      { key: "senderStreet", label: "Sender street address", secret: false, required: true },
      { key: "senderPostalCode", label: "Sender postal code", secret: false, required: true },
      { key: "senderCity", label: "Sender city", secret: false, required: true },
      { key: "senderCountry", label: "Sender country", secret: false, required: true, help: "DHL Paket sends from Germany: DE.", placeholder: "DE", format: "country" },
      { key: "senderPhone", label: "Sender phone", secret: false, required: false, help: "Needed when you ask DHL to collect." },
      { key: "senderEmail", label: "Sender email", secret: false, required: false },
      { key: "collectionHours", label: "Collection hours", secret: false, required: false, help: "When a courier can collect your parcels, written 10:00-17:00, to ask for a collection when you book. Leave it empty if you hand them in or have a standing collection.", placeholder: "10:00-17:00" },
    ],
    docs: "https://developer.dhl.com/api-reference/parcel-de-shipping-post-parcel-germany-v2",
    steps: [
      "Have a DHL business customer contract (an EKP) and access to the Post & DHL Business Customer Portal, and make a system user there for this store.",
      "At developer.dhl.com, make an app with Parcel DE Shipping, Parcel DE Returns, Location Finder - Unified and Shipment Tracking - Unified. DHL approves it for production after you have used the sandbox.",
      "Copy the app's key and secret, the portal user and password and your EKP to the form, with the address in Germany your parcels are sent from.",
      "DHL gives no prices through its API: you enter what you charge for each service and country at checkout. In the test environment use DHL's sandbox user user-valid, password SandboxPasswort2023! and EKP 3333333333.",
    ],
  },
  {
    id: "nshift",
    name: "nShift",
    summary: "Book every carrier of your own agreements through your nShift Delivery account: its delivery checkout's options at checkout, labels, collection and tracking.",
    countries: EUROPE,
    // Return labels are built but not offered until the return shipment's parties are confirmed with an nShift account (D459).
    features: ["rates", "pickup_points", "labels", "tracking", "return_labels", "collection", "cancel"],
    available: ["rates", "pickup_points", "labels", "tracking", "collection", "cancel"],
    fields: [
      { key: "apiKeyId", label: "API key ID", secret: false, required: true, help: "In nShift Delivery under Maintenance → API keys: a key of type Web Services (REST). Copy its ID." },
      { key: "apiKey", label: "API key secret ID", secret: true, required: true, help: "The key's secret ID, shown with its ID." },
      { key: "senderQuickId", label: "Sender quick ID", secret: false, required: true, help: "The Quick ID of your sender in nShift's address book, which holds your customer numbers with each carrier.", placeholder: "1" },
      { key: "checkoutId", label: "Delivery checkout ID", secret: false, required: false, help: "Your delivery checkout in nShift, to offer its options at checkout. Leave it empty to book from orders only." },
      { key: "defaultService", label: "Service for orders without a choice", secret: false, required: false, help: "The nShift service code staff book when the shopper chose your own shipping, like P18 (Help → Code lists in nShift).", placeholder: "P18" },
      { key: "addons", label: "Additional services on every booking", secret: false, required: false, help: "nShift's addon codes your services need, separated by commas, like NOTSMS for a text message to the recipient." },
      { key: "senderName", label: "Sender name", secret: false, required: true, help: "Printed on the label: your business or shop." },
      { key: "senderStreet", label: "Sender street address", secret: false, required: true },
      { key: "senderPostalCode", label: "Sender postal code", secret: false, required: true },
      { key: "senderCity", label: "Sender city", secret: false, required: true },
      { key: "senderCountry", label: "Sender country", secret: false, required: true, help: "The two-letter code of the country you send from, like NO, SE or DE.", placeholder: "NO", format: "country" },
      { key: "senderPhone", label: "Sender phone", secret: false, required: true },
      { key: "senderEmail", label: "Sender email", secret: false, required: false },
      { key: "collectionHours", label: "Collection hours", secret: false, required: false, help: "When a courier can collect your parcels, written 10:00-17:00, to ask for a collection when you book. Leave it empty if you hand them in or have a standing collection.", placeholder: "10:00-17:00" },
    ],
    docs: "https://www.unifaunonline.com/rs-docs/",
    steps: [
      "Have an nShift Delivery account with your carriers' agreements, and order APIConnect (the REST API) in its webshop.",
      "Under Maintenance → API keys, make a key of type Web Services (REST) and copy its ID and secret ID to the form.",
      "Give the Quick ID of your sender in nShift's address book, and the address your parcels are sent from.",
      "To offer nShift's options at checkout, set up a delivery checkout in nShift with your services and prices, and give its ID. Use the test environment first: test shipments print TEST and are not sent to the carrier.",
      ],
    },
  {
    id: "sendcloud",
    name: "Sendcloud",
    summary: "Labels from DHL, DPD, UPS, GLS and many other carriers at Sendcloud's own rates, with no carrier agreement of your own, for shops shipping from western Europe.",
    // Where its carriers deliver for a shop of Flow's: the EU, the EEA's Norway, Switzerland and the UK (D454; read 5 November 2026).
    countries: ["AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK"],
    features: ["rates", "pickup_points", "labels", "tracking", "return_labels"],
    available: [],
    checkable: true,
    fields: [
      { key: "publicKey", label: "Public key", secret: false, required: true, help: "The public key of the Sendcloud API integration you add for this shop." },
      { key: "secretKey", label: "Secret key", secret: true, required: true, help: "Shown by Sendcloud with the public key." },
      {
        key: "senderAddressId",
        label: "Sender address",
        secret: false,
        required: false,
        help: "Where your parcels leave from: one of the sender addresses in your Sendcloud account. Save your keys first, then choose it here.",
        pick: "sender_address",
      },
    ],
    docs: "https://sendcloud.dev",
    steps: [
      "Have a Sendcloud account for a shop shipping from Germany, France, the Netherlands, Belgium, Austria, Italy, Spain or the UK. Sendcloud is not offered to shops shipping from Norway or Finland.",
      "In Sendcloud, open Settings, then Integrations, and add a Sendcloud API integration with Service Points switched on. Copy its public and secret key to the form.",
      "Save, choose the sender address your parcels leave from, and check the connection.",
      "Sendcloud has no test system: the test environment will only make Sendcloud's free test labels, so nothing is shipped or charged.",
    ],
  },
];

export const carrierInfo = (id: string): CarrierInfo | null => CARRIERS.find((c) => c.id === id) ?? null;

/** Whether the store can check its agreement with the carrier: a carrier with something that works, or one marked `checkable`. */
export const canCheck = (info: Pick<CarrierInfo, "available" | "checkable">): boolean => info.available.length > 0 || info.checkable === true;

export const CARRIER_ENVIRONMENTS = ["test", "live"] as const;
export type CarrierEnvironment = (typeof CARRIER_ENVIRONMENTS)[number];

/** What a store has saved for a carrier, as the screens read it: never the secrets themselves. */
export type CarrierSettings = {
  carrier: CarrierId;
  environment: CarrierEnvironment;
  /** The non-secret details, by field key. */
  details: Record<string, string>;
  /** The markets (country codes) the store wants to ship to with it. */
  countries: string[];
  /** Which secret fields are saved, and the last four characters of each to recognise it by. */
  secrets: Record<string, string>;
  /** All the details the carrier needs are saved. */
  complete: boolean;
  /** The last "Check connection": when, whether the carrier accepted the agreement, and what it said. */
  check: { at: string; ok: boolean; message: string | null } | null;
  updatedAt: string;
};

const FIELD_MAX = 200;

/**
 * What the form sends: every field of the carrier as text. A secret left empty keeps the one saved; a detail left empty is
 * missing. Unknown fields are dropped. Returns what to store (`details`, `secrets` only for fields given) or the problems.
 */
export function parseCarrierForm(
  info: CarrierInfo,
  raw: {
    environment: unknown;
    countries: unknown[];
    fields: Record<string, unknown>;
  },
  saved: { hasSecret: (key: string) => boolean },
): { ok: true; environment: CarrierEnvironment; countries: string[]; details: Record<string, string>; secrets: Record<string, string> } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const environment = z.enum(CARRIER_ENVIRONMENTS).safeParse(raw.environment);
  if (!environment.success) problems.push("Choose test or live.");
  const countries = [...new Set(raw.countries.map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  const details: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const field of info.fields) {
    const value = String(raw.fields[field.key] ?? "").trim();
    if (value.length > FIELD_MAX) {
      problems.push(`${field.label} is too long.`);
      continue;
    }
    if (field.pick === "sender_address" && value && !/^\d{1,12}$/.test(value)) {
      problems.push(`Choose the ${field.label.toLowerCase()} from the list.`);
      continue;
    }
    if (field.secret) {
      if (value) secrets[field.key] = value;
      else if (field.required && !saved.hasSecret(field.key)) problems.push(`Enter the ${field.label.toLowerCase()}.`);
    } else if (value && field.format === "country") {
      if (/^[A-Za-z]{2}$/.test(value)) details[field.key] = value.toUpperCase();
      else problems.push(`${field.label}: enter the country's two-letter code, like NO or SE.`);
    } else if (value) {
      details[field.key] = value;
    } else if (field.required) {
      problems.push(`Enter the ${field.label.toLowerCase()}.`);
    }
  }
  return problems.length > 0 || !environment.success ? { ok: false, problems } : { ok: true, environment: environment.data, countries, details, secrets };
}

/** The last four characters of a saved secret, to recognise it by (shorter ones show only dots). */
export const secretHint = (value: string) => (value.length > 8 ? `…${value.slice(-4)}` : "…");

/**
 * Where a store's parcels are sent from, as its carrier page holds it: the sender's name, street, postal code, city and phone, and its country
 * (`senderCountry`, asked by the carriers that ship from anywhere in Europe, D458; Norway for the carriers that only ship from there).
 */
export function senderAddress(details: Record<string, string>): ShippingAddress {
  return {
    name: details.senderName ?? "",
    street: details.senderStreet ?? "",
    postalCode: details.senderPostalCode ?? "",
    city: details.senderCity ?? "",
    country: /^[A-Z]{2}$/.test(details.senderCountry ?? "") ? details.senderCountry : "NO",
    ...(details.senderPhone ? { phone: details.senderPhone } : {}),
    ...(details.senderEmail ? { email: details.senderEmail } : {}),
  };
}

/** Whether every required field is saved. */
export function carrierComplete(info: CarrierInfo, details: Record<string, string>, secretKeys: string[]): boolean {
  return info.fields.every((f) => !f.required || (f.secret ? secretKeys.includes(f.key) : Boolean(details[f.key])));
}

// ---------------------------------------------------------------------------
// The contract each connection will implement
// ---------------------------------------------------------------------------

export type ShippingAddress = {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  phone?: string;
  email?: string;
};

export type ParcelSpec = { weightGrams: number; lengthMm?: number; widthMm?: number; heightMm?: number };

export type RateRequest = {
  from: ShippingAddress;
  to: ShippingAddress;
  parcels: ParcelSpec[];
  currency: string;
  /** When the goods can be collected (ISO times), for a carrier that offers delivery in time windows (D137). */
  pickupWindows?: { start: string; end: string }[];
  /** The carrier's own product ids to ask for, when it has several. */
  products?: string[];
};

/** A delivery window a carrier offered and holds for a time (D137): the shopper's choice is booked with its token. */
export type DeliveryWindow = { start: string; end: string; token: string; expiresAt: string };

export type ShippingOption = {
  /** The carrier's own id for the service, kept to book it. */
  serviceId: string;
  carrier: CarrierId;
  name: string;
  /** Excluding VAT, in minor units of `currency`. */
  priceMinor: number;
  currency: string;
  /** Days, or a window when it is for a time. */
  estimate?: { minDays: number; maxDays: number } | { from: string; to: string };
  /** Set when the shopper must choose a pickup point. */
  needsPickupPoint?: boolean;
  /** Set when this is a window to be delivered in rather than a service (Porterbuddy). */
  window?: DeliveryWindow;
  /** The price already contains VAT (a price made for the shopper to see), so none is added. */
  includesVat?: boolean;
  /** The option's own pickup points, for a carrier whose options each come with theirs (nShift's delivery checkout, D459). */
  pickupPoints?: PickupPoint[];
};

export type PickupPoint = { id: string; name: string; address: ShippingAddress; openingHours?: string; distanceMeters?: number };

export type BookingRequest = {
  orderReference: string;
  /**
   * What makes a retry of this parcel the same booking at a carrier that takes an idempotency key (Porterbuddy): one per parcel of the order
   * (`parcelReference()`, D372), so a retry is never booked twice and another parcel of the same order is never taken for the first. None: the order's reference.
   */
  parcelReference?: string;
  serviceId: string;
  from: ShippingAddress;
  to: ShippingAddress;
  parcels: ParcelSpec[];
  pickupPointId?: string;
  /** The window the shopper chose, with the token the carrier gave for it (D137). */
  window?: DeliveryWindow;
  courierInstructions?: string;
  /**
   * Ask the carrier to collect the parcel at the sender's address (D459): the day (YYYY-MM-DD, the sender's own) and the window it is ready in
   * ("HH:MM", the sender's local time). Only carriers with `collection` in `available` read it; the others book as if it were absent.
   */
  collection?: { date: string; readyTime: string; closeTime: string };
  /** The customs declaration of a consignment that crosses a customs border (D343): required then, and a carrier refuses to book without it. */
  customs?: BookingCustoms;
};

/** One line of a customs declaration (D343): what the goods are, where they come from, what they are worth and weigh. */
export type CustomsLine = {
  /** The HS code, 6 to 10 digits. */
  hsCode: string;
  /** The country of origin (ISO). */
  origin: string;
  /** The line's value, without VAT, in minor units of the declaration's currency. */
  valueMinor: number;
  description: string;
  quantity: number;
  /** The line's total weight. */
  weightGrams: number;
};

/** A consignment's customs declaration (D343): who pays duties (DDP: the sender; DAP: the recipient), the invoice it rests on, and its lines. */
export type BookingCustoms = {
  incoterm: "DAP" | "DDP";
  currency: string;
  invoiceNumber: string;
  /** YYYY-MM-DD. */
  invoiceDate: string;
  lines: CustomsLine[];
};

/**
 * Why a booking cannot be made for want of its customs lines (D343), or null: a consignment that crosses a customs border (another country outside
 * the EU's customs union, `crossesBorder()`) needs a declaration with at least one line, each with its HS code, origin, value, description, quantity
 * and weight. Every carrier's `book()` asks this before it calls the carrier. Plain English for staff.
 */
export function bookingCustomsProblem(request: Pick<BookingRequest, "from" | "to" | "customs">): string | null {
  if (!crossesBorder(request.from.country.toUpperCase(), request.to.country.toUpperCase())) return null;
  const customs = request.customs;
  if (!customs || customs.lines.length === 0) return "This parcel crosses a customs border: it needs its customs lines (HS code, origin, value, description, quantity and weight) before it can be booked.";
  if (!/^[A-Z]{3}$/.test(customs.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(customs.invoiceDate) || customs.invoiceNumber.trim() === "") {
    return "The customs declaration needs its currency, invoice number and date.";
  }
  for (const line of customs.lines) {
    const name = line.description.trim() || "A line";
    if (!HS_CODE.test(line.hsCode)) return `${name} has no HS code: add it to the product before booking.`;
    if (!/^[A-Z]{2}$/.test(line.origin)) return `${name} has no country of origin: add it to the product before booking.`;
    if (!Number.isSafeInteger(line.valueMinor) || line.valueMinor < 0) return `${name} has no value to declare.`;
    if (!Number.isInteger(line.quantity) || line.quantity < 1) return `${name} has no quantity to declare.`;
    if (!Number.isFinite(line.weightGrams) || line.weightGrams < 1) return `${name} has no weight: add it to the product before booking.`;
    if (line.description.trim() === "") return "Every customs line needs a description of the goods.";
  }
  return null;
}

export type BookingResult = {
  trackingNumber: string;
  trackingUrl: string | null;
  /** The carrier's own number for the whole shipment, when it has one. */
  consignmentNumber: string | null;
  /** Where the label can be fetched again with the agreement's keys. */
  labelUrl: string | null;
  /** Made in the carrier's test mode: nothing was shipped. */
  test: boolean;
  /**
   * The label's PDF, for a carrier that gives it only in its answer and never again (DHL Express, D458): kept in `carrier_labels` with the parcel
   * until it has been printed for a while (`labelUrl` then says where the shipment is at the carrier). Absent for a carrier whose label is fetched.
   */
  labelPdf?: Uint8Array;
  /**
   * The customs declaration sent with a consignment that crosses a border (D343): `declared` when the carrier accepted it, else its reason (the
   * shipment is booked either way, and staff are told to declare it in the carrier's own tools). Absent where nothing was declared.
   */
  customs?: { declared: boolean; reference: string | null; problem: string | null };
  /**
   * What became of a collection asked for (D459): the carrier's confirmation number when it took it, else why not (the shipment is booked either
   * way, and staff are told to arrange the collection in the carrier's own tools). Absent when none was asked for.
   */
  collection?: { booked: boolean; confirmation: string | null; problem: string | null };
};

/**
 * A return label (D239 4.7): a shipment from the shopper's address back to the store's return address, booked on the store's own agreement with the
 * carrier's return service. `from` is the order's shipping address with the order's email (and phone when known: optional for Bring's return services);
 * `to` is the return address with the store's contact email and phone.
 */
export type ReturnBookingRequest = {
  /** The return's number (`{order number}-R{n}`). */
  returnReference: string;
  serviceId: string;
  from: ShippingAddress;
  to: ShippingAddress;
  parcels: ParcelSpec[];
};
export type ReturnBookingResult = BookingResult & {
  /** What the carrier priced the label at, when it said: minor units of `currency`, with or without VAT as it said. */
  price?: { amountMinor: number; currency: string; vatIncluded: boolean } | null;
};

export type TrackingEvent = { at: string; status: string; description: string; location?: string };

/** What a connection is given: the store's own agreement, secrets decrypted for the call only. */
export type CarrierContext = {
  storeId: string;
  environment: CarrierEnvironment;
  details: Record<string, string>;
  secrets: Record<string, string>;
};

/** The one interface each carrier's connection implements; a method a carrier cannot do is left out. */
export interface ShippingCarrierAdapter {
  readonly id: CarrierId;
  /** Checks the agreement with a harmless call; the message is shown to the owner. */
  check(context: CarrierContext): Promise<{ ok: true } | { ok: false; problem: string }>;
  rates?(context: CarrierContext, request: RateRequest): Promise<ShippingOption[]>;
  pickupPoints?(context: CarrierContext, near: ShippingAddress): Promise<PickupPoint[]>;
  book?(context: CarrierContext, request: BookingRequest): Promise<BookingResult>;
  /** Books a return label (D239): only carriers with `return_labels` in `available` implement it. */
  bookReturn?(context: CarrierContext, request: ReturnBookingRequest): Promise<ReturnBookingResult>;
  /** `lang`: the order's language, for carriers that describe events in it (Bring, D238 4.5); others ignore it. */
  track?(context: CarrierContext, trackingNumber: string, options?: { lang?: string }): Promise<TrackingEvent[]>;
  /**
   * Cancels a booked shipment that has not been handed over (D459), when staff undo its parcel: carriers with `cancel` in `available` implement it.
   * Given the parcel as its shipment keeps it; the answer's problem is a plain sentence for staff (the parcel stays undone in Kaizena Flow either way).
   */
  cancel?(context: CarrierContext, shipment: { trackingNumber: string; consignmentNumber: string | null }): Promise<{ ok: true } | { ok: false; problem: string }>;
}
