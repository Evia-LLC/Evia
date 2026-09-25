/** Verbatim guide §2–4 and §8–10. Review copy does not imply legal approval. */
export const HEALTH_COPY = {
  "title": "Permission to collect your skin and health information",
  "body": "Information about your skin, and anything you tell us about allergies, medications or pregnancy, is treated as consumer health data where you live. We collect it only to provide the service you have asked for.",
  "checkbox": "I consent to Evia collecting my consumer health data as described in the Consumer Health Data Privacy Policy.",
  "footer": "We never sell consumer health data."
} as const;

export const SAFETY_COPY = {
  "title": "Optional, and only if it helps your results",
  "body": "Telling us about allergies, medications, pregnancy or breastfeeding, or about sleep, diet and water intake, helps us filter suggestions. You can skip this, and you can delete it later. It is not a safety check, so always read product labels and speak to a healthcare professional where needed.",
  "checkbox": "I choose to share this information and consent to Evia using it to personalise my suggestions.",
  "skip": "Skip for now"
} as const;

export const PHOTO_COPY = {
  "title": "Save this photo to track your progress?",
  "body": "By default we delete your scan images after your session. If you would like to compare your skin over time, we can save this photo to your account instead.",
  "checkbox": "Save my progress photos. I understand they are stored in my account until I delete them or delete my account, and that I can turn this off at any time."
} as const;

export const AI_COPY = {
  "consultation": "You are chatting with Evia, an AI assistant. This is general skincare guidance, not medical advice.",
  "result": "Cosmetic observations only. Evia does not diagnose medical conditions.",
  "escalation": "Evia cannot tell whether this needs medical attention. If this area is new, changing, painful or not healing, please have it looked at by a healthcare professional."
} as const;

export const COOKIE_COPY = {
  "body": "We use strictly necessary cookies to run Evia. With your permission we also use analytics and marketing cookies. We never send your scan images, skin results or health answers to these tools.",
  "buttons": "Accept all | Reject all | Manage preferences"
} as const;

export const ACCOUNT_COPY = {
  "withdraw": "Withdraw scan consent, with plain explanation of what stops working and what is deleted.",
  "photos": "Turn progress photos on or off, and delete individual photos.",
  "download": "Download my data.",
  "delete": "Delete my account and all data, with confirmation and statement of what is retained for legal reasons.",
  "marketing": "Manage marketing preferences.",
  "cookies": "Manage cookie preferences.",
  "history": "View version of each policy accepted, with date.",
  "guardian": "Guardian has access"
} as const;
