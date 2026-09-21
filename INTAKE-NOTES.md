# Ese consultation intake

The intake is a self-reported skincare conversation, not a medical assessment, diagnosis, treatment clearance, photo analysis, or exhaustive clinical questionnaire. Every question can be skipped. Age is an optional range; no birthday, sex, location, dose, or complete medical history is requested. Pregnancy/breastfeeding appears only after a choice to include that question; skipped or withheld answers remain unknown.

Before account creation, the draft stays in component memory. `onPresent` emits fixed public prompts and character directives, never entered names or health answers. The account form is separate. Call `persistIntake(draft)` only after successful authentication. Declined storage returns without any request; the caller must discard the draft after account creation. The storage choice does not enable cloud processing, image storage, or ongoing personalized speech.

`PUT /api/me/intake` validates a closed payload and derives ownership from the session. Intake and selected profile updates commit atomically. Only preferred name, declared skin feel, selected goals, and an explicitly answered pregnancy status map to the existing profile. Other detailed notes are not added to AI prompts or interpreted as allergies/contraindications by the recommendation engine; do not claim that completing intake makes a recommendation medically suitable. Existing cloud consent governs the existing profile fields separately.

Migration `011_consultation_intake.sql` adds `consultation_intakes` with an owner foreign key and account-delete cascade. `GET /api/me/intake` and `GET /api/me/intake/export` return only the signed-in account's record with `Cache-Control: no-store`. The export route supplies a JSON attachment. Raw notes must not be logged or sent to analytics. Existing deployment database access and backup retention controls also apply to this table.

The component places the plaque to the avatar's right on desktop. Below 760px it begins at 44% of the viewport with its own scroll area, leaving the avatar above. Root integration supplies `onPresent`; use the existing consent-aware voice/character path and text fallback. No component action requests a photo or calls an AI service.

The question wording and limits are product design choices informed by primary guidance, not a validated clinical intake instrument:

- [AAD: pregnancy skin care](https://www.aad.org/public/everyday-care/skin-care-secrets/routine/pregnancy-skin-care) supports checking relevant medications and products with a clinician during pregnancy/breastfeeding; the intake makes no product-specific clearance.
- [FDA: allergens in cosmetics](https://www.fda.gov/cosmetics/cosmetic-ingredients/allergens-cosmetics) supports asking about known product reactions and directing current breathing/swallowing difficulties to urgent medical care. The intake does not diagnose an allergy.
- [AAD: acne-scar consultation](https://www.aad.org/public/diseases/acne/derm-treat/scars/treatment) explains why treatment expectations and medication/procedure history can matter. No treatment plan is generated here.
- [AAD: sunscreen selection](https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen) supports including sun protection in the routine discussion. The intake asks about existing habits without scoring the person.
