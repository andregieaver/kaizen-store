import type { PlatformLegalWords } from "../platform-legal";

/**
 * Kaizena Flow's own legal pages in English (D312 P5): the terms of service for the businesses that run stores on it, its privacy
 * notice as a controller, and the data processing agreement for what it processes on stores' behalf. Hand-written, never by a model;
 * published as written by the owner's decision, without a lawyer's review. Bodies are read by `textToRichText()`: a blank line between
 * paragraphs, "- " for a list item, **bold**, [links](/address).
 */
export const EN: PlatformLegalWords = {
  lang: "en",
  updated: (date) => `Last updated: ${date}`,
  missing: {
    legalName: "[company name to be added]",
    organisationNumber: "[organisation number to be added]",
    postalAddress: "[address to be added]",
    contactEmail: "[email address to be added]",
  },
  links: { terms: "/terms", privacy: "/privacy", dpa: "/data-processing-agreement", cookies: "/cookies" },
  docs: (f) => ({
    terms: {
      title: "Terms of service",
      description: "The terms for businesses that run online stores on Kaizena Flow.",
      sections: [
        {
          topic: "about",
          heading: "1. About these terms",
          body: `Kaizena Flow is provided by ${f.legalName}, organisation number ${f.organisationNumber}, ${f.postalAddress} ("Kaizena Flow", "we", "us"). You can reach us at ${f.contactEmail}.

These terms apply between us and the business that uses Kaizena Flow to run one or more online stores ("you"). They apply from the moment your request for access is approved or you first use the service. The [data processing agreement](${f.links.dpa}) and the prices shown for your plan are part of these terms.

Kaizena Flow is for businesses only. You confirm that you act in the course of your trade or profession and that the person accepting these terms may bind the business.`,
        },
        {
          topic: "service",
          heading: "2. The service",
          body: `Kaizena Flow is a hosted platform for running an online store: the storefront, the admin, the page builder and themes, catalogue, orders and customers, checkout through payment providers you connect, emails, analytics, support tools and features that use artificial intelligence (AI).

We develop the service continuously. We may add, change and remove features. If we remove or materially reduce a feature you pay for, we tell you at least 30 days before, unless the change is required by law or for security.`,
        },
        {
          topic: "account",
          heading: "3. Your account and your staff",
          body: `You give us correct information about your business and keep it up to date. You keep sign-in details secret and use two-step sign-in where the admin asks for it.

You decide who in your business has access, and with what role. You are responsible for what is done in your stores by the people you give access to, as if you had done it yourself. Tell us at once if you believe an account has been misused.`,
        },
        {
          topic: "stores",
          heading: "4. Your store and your customers",
          body: `You are the seller in your store. The contracts with your customers are between you and them; we are not a party to them.

You are responsible for your products and services, your prices and VAT, the texts and pictures you publish, your terms of sale, privacy notice and other legal pages, and for following the consumer, marketing, tax and other rules that apply to your sales in every country you sell to.

Kaizena Flow offers starter texts for legal pages and other help. They are a starting point only: you must read them, adapt them to your business and decide whether to use them.`,
        },
        {
          topic: "payments",
          heading: "5. Payments from your customers",
          body: `Your customers pay through a payment provider you connect, such as Stripe or Mollie, under your own agreement with that provider. The provider pays the money out to you. We never hold your customers' money.

Refunds, chargebacks and disputes are handled between you, your customer and the payment provider. Kaizena Flow gives you tools to manage them but does not decide them.`,
        },
        {
          topic: "fees",
          heading: "6. Prices and payment to us",
          body: `You pay the price of the plan you choose and the sale fee that applies to your store, as shown in the admin when you choose or change the plan. The sale fee is currently ${f.saleFee} of each payment unless your plan or agreement says otherwise, and is taken as a fee on the payment through your payment provider. Premium themes are paid once per store, at the price shown before you make them live.

All prices are shown without VAT, which is added where it applies. We invoice through Stripe; plans are paid in advance for each period.

If an invoice is not paid on time, we may send reminders and charge late-payment interest under the law that applies. If it is still not paid 14 days after a reminder, we may suspend the stores concerned until it is paid.

We may change prices with at least 30 days' notice. A change takes effect from your next billing period after the notice; if you do not accept it, you may end your plan before it takes effect.`,
        },
        {
          topic: "use",
          heading: "7. Acceptable use",
          body: `You must not use Kaizena Flow to:

- sell goods or services that are illegal where they are sold or sent, or that a payment provider you use does not allow
- publish content that infringes others' rights or is unlawful, misleading or hateful
- send email to people who have not agreed to receive it, where their agreement is required
- spread malware, attack, overload or probe the service or other stores, or get round its limits and security
- copy, resell or reverse-engineer the service, except as the law allows

We may remove content and suspend a store or an account that breaks these rules, as set out in section 12.`,
        },
        {
          topic: "ai",
          heading: "8. Features that use AI",
          body: `Some features use AI models to suggest texts, translations, pictures, answers and actions. What a model writes can be wrong. Suggestions are for you to check before you use them; changes the AI manager proposes for your store are made only when you approve them, except where the admin says otherwise during setup.

When you use AI features on Kaizena Flow's own connection, the text and pictures you send are processed by the AI provider we use, as described in the [privacy notice](${f.links.privacy}) and the [data processing agreement](${f.links.dpa}). If you connect your own AI provider, your own agreement with that provider applies to what is sent to it. We may set limits on how much AI a plan includes.`,
        },
        {
          topic: "content",
          heading: "9. Content and rights",
          body: `You keep all rights to your content: your texts, pictures, products, customer data and other material you put into Kaizena Flow. You give us the right to store, copy, show and process it as needed to provide the service to you and your customers, and to make it available when you share or publish it.

We and our licensors keep all rights to the service, its software, its design and its themes. While your plan lasts, you may use the themes and parts we offer in your own stores. Pictures we or an AI model make for you may be used in your stores; you are responsible for how you use them.

If you send us ideas or feedback, we may use them freely.`,
        },
        {
          topic: "data",
          heading: "10. Personal data",
          body: `For the personal data we process about you and your staff to run our relationship with you, we are the controller, as described in the [privacy notice](${f.links.privacy}).

For the personal data about your customers and others that we process in your stores on your behalf, you are the controller and we are your processor. The [data processing agreement](${f.links.dpa}) applies to that processing and is part of these terms.`,
        },
        {
          topic: "availability",
          heading: "11. Availability and support",
          body: `We work to keep Kaizena Flow available and secure at all times, but we do not promise that it will be without interruption or errors. We may carry out maintenance, preferably when traffic is low, and tell you in advance where we can.

You can ask for help through "Contact Kaizena Flow support" in the admin's account menu or by email to ${f.contactEmail}.`,
        },
        {
          topic: "termination",
          heading: "12. Suspension and ending",
          body: `You may end your plan at any time; it then runs to the end of the period you have paid for. You may close a store in its settings.

We may suspend a store or an account at once if you break these terms in a way that harms others or puts the service at risk, if the law or an authority requires it, or as set out in section 6 for unpaid invoices. Where we can, we tell you first and give you a chance to put things right. We may end these terms with 30 days' notice, or at once if you materially break them and do not put this right within 14 days of our notice.

Before your stores are closed for good you can export your data from the admin. Orders, invoices and other records we must keep by law are kept for as long as the law requires, as described in the [privacy notice](${f.links.privacy}).`,
        },
        {
          topic: "liability",
          heading: "13. Liability",
          body: `The service is provided as it is at any time. We are not liable for indirect or consequential loss, such as lost profit, lost sales, lost goodwill or loss of data you could have restored from your own exports.

Our total liability for all claims in any 12-month period is limited to the fees you paid us in the 12 months before the event that caused the claim.

These limits do not apply to loss caused by our gross negligence or wilful misconduct, or where the law does not allow liability to be limited.`,
        },
        {
          topic: "indemnity",
          heading: "14. Claims from others",
          body: `You hold us harmless against claims from your customers, authorities and others that arise from your products and services, your sales, your content or your breach of these terms or the law, including reasonable legal costs.`,
        },
        {
          topic: "changes",
          heading: "15. Changes to these terms",
          body: `We may change these terms. We tell you about material changes by email or in the admin at least 30 days before they take effect. If you continue to use the service after that, the new terms apply. If you do not accept them, you may end your plan before they take effect.`,
        },
        {
          topic: "law",
          heading: "16. Law and disputes",
          body: `These terms are governed by Norwegian law. We will try to settle any disagreement by talking with you first. If we cannot, disputes are settled by the ordinary courts at our registered office.`,
        },
        {
          topic: "contact",
          heading: "17. Contact",
          body: `${f.legalName}
${f.postalAddress}
Organisation number ${f.organisationNumber}
${f.contactEmail}`,
        },
      ],
    },
    privacy: {
      title: "Privacy notice",
      description: "How Kaizena Flow processes personal data about visitors, store owners and their staff.",
      sections: [
        {
          topic: "controller",
          heading: "1. Who is responsible",
          body: `${f.legalName}, organisation number ${f.organisationNumber}, ${f.postalAddress}, is the controller for the processing described in this notice. Contact us about privacy at ${f.contactEmail}.`,
        },
        {
          topic: "scope",
          heading: "2. What this notice covers",
          body: `This notice covers the personal data we process about people who visit Kaizena Flow's own website, ask for access, run stores on Kaizena Flow or work in them, and contact us.

It does not cover what stores do with their own customers' data. Each store is the controller for its customers and visitors and has its own privacy notice; we process that data on the store's behalf under our [data processing agreement](${f.links.dpa}).`,
        },
        {
          topic: "purposes",
          heading: "3. What we process, why, and on what basis",
          body: `- **Requests for access:** your name, email address, the store you want to open, what you tell us and the language you write in, to consider your request and reply. Basis: steps at your request before entering into a contract (GDPR Article 6(1)(b)).
- **Your account:** name, email address, password (stored only as a protected hash by our sign-in provider), profile picture, two-step sign-in factors and recovery codes (stored as hashes), and your choices of language and appearance, to give you access to the admin. Basis: our contract with you or your employer (Article 6(1)(b) and (f)).
- **Security and the activity log:** sign-ins and the changes made in each store, with who made them and when, to keep the service and stores secure and to let owners see what was done. Basis: legitimate interest in security (Article 6(1)(f)).
- **Billing:** your business's details, your plan, invoices and payments, to charge for the service and keep accounts. Basis: our contract (Article 6(1)(b)) and our legal duty to keep accounts (Article 6(1)(c) and the Norwegian Bookkeeping Act).
- **Support and the AI manager:** what you write to Kaizena Flow's support and to the AI manager, and what the AI manager remembers for you (which you can see, change and turn off), to help you. Basis: our contract (Article 6(1)(b)).
- **Emails we send:** the emails we send you and whether they were delivered, to send what the service needs to tell you. Basis: our contract and legitimate interest (Article 6(1)(b) and (f)).
- **Our website:** the cookies needed for the site to work. Cookies for statistics or marketing, and the referral programme's cookie, are set only if you agree, and your choice is kept for 12 months. Basis: consent (Article 6(1)(a)). See the [cookies page](${f.links.cookies}).
- **The referral programme:** who referred a store and the credit earned, to pay the referrer. Basis: our contract with the referrer (Article 6(1)(b)).`,
        },
        {
          topic: "recipients",
          heading: "4. Who we share data with",
          body: `We use these providers to run Kaizena Flow. They process personal data only on our instructions:

- **Vercel** (hosting; our functions run in Dublin, Ireland)
- **Supabase** (database, sign-in and file storage, in Ireland)
- **Resend** (sending email)
- **OpenAI** (AI features, when Kaizena Flow's own AI connection is used)
- **Stripe** (invoicing and payment of our fees; Stripe is also the controller of the payment data it processes under its own terms)

We also share data where the law requires it, for example with tax authorities, and with a business that takes over all or part of ours, who must then follow this notice.`,
        },
        {
          topic: "transfers",
          heading: "5. Transfers outside the EEA",
          body: `Our database and functions are in the EU. Some of our providers are based in the United States or may reach data from there. Such transfers are made under the EU–US Data Privacy Framework where the provider is certified, or otherwise under the standard contractual clauses adopted by the European Commission (GDPR Articles 45 and 46).`,
        },
        {
          topic: "retention",
          heading: "6. How long we keep data",
          body: `- Requests for access: until the request is decided, and then as long as needed to answer questions about it.
- Accounts: as long as the account exists. When you ask us to delete it, we do so unless the account is still needed for a store you are responsible for.
- The activity log: 24 months.
- Accounting records, such as invoices: five years after the end of the financial year (the Norwegian Bookkeeping Act, section 13).
- Support conversations: as long as set for the support desk, and then anonymised.
- Your cookie choices: 12 months.`,
        },
        {
          topic: "rights",
          heading: "7. Your rights",
          body: `You have the right to:

- access the personal data we hold about you (GDPR Article 15)
- have incorrect data corrected (Article 16)
- have data erased (Article 17)
- have processing restricted (Article 18)
- receive your data in a machine-readable form and have it sent to another controller (Article 20)
- object to processing based on our legitimate interest (Article 21)
- withdraw your consent at any time, without affecting what was done before (Article 7(3))

Write to ${f.contactEmail}. You can change many of your details yourself under "Your account" in the admin. We answer within one month (Article 12(3)).`,
        },
        {
          topic: "complaint",
          heading: "8. Complaints",
          body: `If you think we process your data unlawfully, you may complain to a supervisory authority, in particular in the country where you live or work (Article 77). In Norway this is Datatilsynet, datatilsynet.no. We would be glad if you contacted us first.`,
        },
        {
          topic: "obligation",
          heading: "9. Do you have to give us data?",
          body: `You need to give us your name and email address to get an account, and your business's details to buy a plan. Everything else is up to you.`,
        },
        {
          topic: "automated",
          heading: "10. Automated decisions",
          body: `We make no decisions based solely on automated processing that have legal or similarly significant effects for you (Article 22). The AI features suggest; a person decides.`,
        },
        {
          topic: "security",
          heading: "11. Security",
          body: `Data is encrypted on its way to and from Kaizena Flow. Passwords, recovery codes and access tokens are stored only as hashes, and secrets such as integration keys are encrypted. Staff sign in with two-step sign-in where the admin asks for it, and every store's data is kept apart from other stores'.`,
        },
        {
          topic: "changes",
          heading: "12. Changes",
          body: `We update this notice when what we do changes. The date at the top shows when it was last changed. We tell account holders about material changes by email or in the admin.`,
        },
      ],
    },
    dpa: {
      title: "Data processing agreement",
      description: "The data processing agreement between a store on Kaizena Flow and Kaizena Flow as its processor.",
      sections: [
        {
          topic: "parties",
          heading: "1. Parties and scope",
          body: `This agreement is between the business that runs a store on Kaizena Flow (the controller, "you") and ${f.legalName}, organisation number ${f.organisationNumber} (the processor, "we"). It is part of our [terms of service](${f.links.terms}) and applies for as long as we process personal data on your behalf.

It meets the requirements of Article 28(3) of the General Data Protection Regulation (GDPR). If it conflicts with the terms of service on the processing of personal data, this agreement applies.`,
        },
        {
          topic: "processing",
          heading: "2. The processing",
          body: `- **Subject matter and purpose:** hosting and running your stores and the tools in the admin, so that you can sell, deliver, invoice, give support and market to your customers.
- **Nature:** storing, organising, showing, sending, analysing, translating and deleting data, as you use the service.
- **Duration:** as long as you have stores on Kaizena Flow, and until the data is deleted or returned as in section 11.
- **Data subjects:** your customers and shoppers, people who sign up to your lists, fill in your forms, book with you or contact you, and the people you give access to the admin.
- **Types of personal data:** names, email addresses, phone numbers and postal addresses, company details, orders, bookings, returns and invoices, payment references (never card numbers, which only the payment provider sees), messages and support conversations, reviews, consent and subscription records, and the custom fields you choose to add.

You decide which special categories of personal data, if any, are processed. The service is not designed for them, and you should not collect them in it unless you have a lawful basis and have assessed the risk.`,
        },
        {
          topic: "instructions",
          heading: "3. Your instructions",
          body: `We process personal data only on your documented instructions: this agreement, the terms of service and the settings and actions you and your staff choose in the admin. We do not process it for our own purposes, except to keep accounts of our fees and where the law requires it. If the law requires us to process it in another way, we tell you first unless the law forbids it.

We tell you at once if we believe an instruction breaks data protection law.`,
        },
        {
          topic: "confidentiality",
          heading: "4. Confidentiality",
          body: `Everyone at Kaizena Flow who can reach your personal data is bound by a duty of confidentiality and reaches it only as far as needed to run, support and secure the service. Kaizena Flow's platform administrators do not read your stores' support conversations.`,
        },
        {
          topic: "security",
          heading: "5. Security",
          body: `We take the technical and organisational measures GDPR Article 32 requires, including:

- encryption of data on its way to and from the service, and of stored secrets
- passwords, recovery codes and tokens kept only as hashes
- each store's data kept apart from other stores', with access checked on every request
- roles and permissions for your staff, two-step sign-in and an activity log of changes
- backups of the database and the ability to restore it
- hosting in data centres in the EU with their own physical security

We review and improve the measures as risks and technology change.`,
        },
        {
          topic: "subprocessors",
          heading: "6. Sub-processors",
          body: `You give us general authorisation to use sub-processors. We use these today:

- **Vercel** (hosting; functions in Dublin, Ireland)
- **Supabase** (database, sign-in and file storage, in Ireland)
- **Resend** (sending the emails your store sends)
- **OpenAI** (AI features, when Kaizena Flow's own AI connection is used)

We tell you at least 30 days before we add or replace a sub-processor. If you object on reasonable grounds and we cannot meet the objection, you may end the affected service before the change takes effect. We bind each sub-processor to the same data protection obligations as in this agreement and are responsible for its compliance.

Services you connect yourself are not our sub-processors: payment providers such as Stripe and Mollie, carriers, your own AI provider, Slack, analytics and marketing tools. Your own agreements with them apply.`,
        },
        {
          topic: "transfers",
          heading: "7. Transfers outside the EEA",
          body: `Your stores' data is stored in the EU. Where a sub-processor can reach data from a country outside the EEA, the transfer is made under the EU–US Data Privacy Framework where the sub-processor is certified, or otherwise under the standard contractual clauses adopted by the European Commission (GDPR Articles 45 and 46).`,
        },
        {
          topic: "rights",
          heading: "8. Helping with data subjects' rights",
          body: `The admin lets you answer requests from data subjects yourself: you can find, correct and export a customer's data and erase or anonymise it, while orders you must keep by law are kept restricted. If a data subject contacts us directly about your store, we send the request on to you without undue delay and do not answer it ourselves unless you ask us to.`,
        },
        {
          topic: "assistance",
          heading: "9. Other assistance",
          body: `Taking into account the nature of the processing and the information available to us, we help you meet your obligations under GDPR Articles 32 to 36: security, notifying breaches, data protection impact assessments and prior consultation.`,
        },
        {
          topic: "breach",
          heading: "10. Personal data breaches",
          body: `We notify you without undue delay, and no later than 48 hours after we became aware of it, of a personal data breach that affects your stores. The notice describes what happened as far as we know it, the data and people likely to be affected, the likely consequences and what we are doing about it, and is followed up as we learn more. You decide whether to notify the supervisory authority and the people affected (GDPR Articles 33 and 34).`,
        },
        {
          topic: "end",
          heading: "11. When the processing ends",
          body: `Before you close a store you can export its data from the admin. After the store is closed for good, we delete or anonymise its personal data within 90 days, except what the law requires to be kept, such as orders and invoices under accounting rules, which is kept restricted for the period required and then anonymised.`,
        },
        {
          topic: "audits",
          heading: "12. Information and audits",
          body: `We make available to you the information needed to show that we meet this agreement. You may audit our compliance, yourself or through an independent auditor bound by confidentiality, with at least 30 days' notice, once a year unless a breach or an authority gives reason for more. Each party bears its own costs.`,
        },
        {
          topic: "liability",
          heading: "13. Liability and law",
          body: `Liability between us follows the terms of service, without limiting what GDPR Article 82 gives data subjects. This agreement is governed by Norwegian law, as the terms of service are.`,
        },
      ],
    },
  }),
};
