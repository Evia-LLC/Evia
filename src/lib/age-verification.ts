export interface AgeVerificationUserData {
  email: string;
  dateOfBirth: string;
}

// TEMPORARY — pending certified vendor selection
export async function verifyAge(_userData: AgeVerificationUserData) {
  // No personal data is transmitted or retained by this demo stub.
  return { verified: false, mock: true, reason: 'no provider selected' } as const;
}
