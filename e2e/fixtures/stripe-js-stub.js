// A stand-in for Stripe.js in the browser (bloat review step 1.7). Test-only and never bundled: it lives under e2e/, and only
// e2e/performance.spec.ts's money path serves it, by routing https://js.stripe.com/** to this file. It defines window.Stripe with the
// least the checkout's form calls (src/components/checkout-form.tsx: loadStripe() from @stripe/stripe-js, then
// CheckoutElementsProvider from @stripe/react-stripe-js/checkout): the instance's initCheckoutElementsSdk(), the SDK's loadActions(),
// on(), changeAppearance(), loadFonts() and its create…Element() calls, and each element's mount(), on(), off(), update() and destroy().
// The payment element draws a box marked data-testid="payment-form-stub". Nothing here calls the network, takes a card or pays:
// confirm() answers an error.
(function () {
  "use strict";

  // Each box about as tall as Stripe's own element on a phone, so what sits under the form is where a shopper sees it (a shorter box
  // pulls the page's lower links into view, and the router asks for them).
  var HEIGHTS = { "contact-details": 72, "shipping-address": 360, "billing-address": 360, "payment-form": 280, "express-checkout": 48 };

  function element(kind) {
    return {
      mount: function (node) {
        var target = typeof node === "string" ? document.querySelector(node) : node;
        if (!target) return;
        var box = document.createElement("div");
        box.setAttribute("data-testid", kind + "-stub");
        box.style.minHeight = (HEIGHTS[kind] || 48) + "px";
        box.style.border = "1px dashed currentColor";
        box.textContent = "Stripe stand-in: " + kind;
        target.appendChild(box);
      },
      on: function () {},
      off: function () {},
      update: function () {},
      destroy: function () {},
    };
  }

  function checkoutSdk() {
    var session = { status: { type: "open" }, lineItems: [], total: {} };
    return {
      on: function () {},
      changeAppearance: function () {},
      loadFonts: function () {},
      loadActions: function () {
        return Promise.resolve({
          type: "success",
          actions: {
            getSession: function () {
              return session;
            },
            confirm: function () {
              return Promise.resolve({ type: "error", error: { message: "The Stripe stand-in takes no payment." } });
            },
          },
        });
      },
      createPaymentElement: function () {
        return element("payment-form");
      },
      createShippingAddressElement: function () {
        return element("shipping-address");
      },
      createBillingAddressElement: function () {
        return element("billing-address");
      },
      createContactDetailsElement: function () {
        return element("contact-details");
      },
      createExpressCheckoutElement: function () {
        return element("express-checkout");
      },
    };
  }

  function unused() {
    return Promise.resolve({ error: { message: "The Stripe stand-in does not do this." } });
  }

  function Stripe() {
    return {
      // What @stripe/react-stripe-js checks a Stripe instance by.
      elements: function () {
        return { create: element, getElement: function () { return null; } };
      },
      createToken: unused,
      createPaymentMethod: unused,
      confirmCardPayment: unused,
      _registerWrapper: function () {},
      registerAppInfo: function () {},
      initCheckoutElementsSdk: checkoutSdk,
    };
  }
  // The release @stripe/stripe-js expects (it warns on another with a test key).
  Stripe.version = "dahlia";
  window.Stripe = Stripe;
})();
