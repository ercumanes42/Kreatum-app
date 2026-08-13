export const restoreCustomClaimsAfterFailedPostcondition = async (
  auth,
  uid,
  originalClaims,
) => {
  await auth.setCustomUserClaims(uid, originalClaims);
  await auth.revokeRefreshTokens(uid);
};
