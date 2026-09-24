-- Self-declared DOB, never an age-verification or guardian-approval result.
ALTER TABLE users ADD COLUMN date_of_birth TEXT;
