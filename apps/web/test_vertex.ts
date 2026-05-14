import { GoogleAuth } from 'google-auth-library';
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || 'firebase-adminsdk-fbsvc@contentloop-dev.iam.gserviceaccount.com';
const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDk8pM4nYOuja91\nxe6PpQL9obZuxIF8qS/BqT6uq/qPfzUUtFRXHZpNJ54DljDsNUuABa3n+lse6jD9\nYznXI46M/iDOcUNGMU3xRDTaCQHNjSv9hrjTcHBo9uBxW6OLSNKo2H0HlNt8U2kZ\nuprHSH8jthHb6MK5HK5c1Qf17lk4259VJ5ZKTBKzpKhz2WpHELfL4+46FBq8x3W2\naGarSKApsATVbUuIENHSqNC2EgvDylsA3oB2FT7aisX1KXT0Vc+hUIMdrA9uUnBj\nEsME1+GHWdqMdoSlxdx2Zq0MVK2sJiB6HOqK/WZHAXxsmXBpXzOashlnFLGGwIsD\nZibKXgL/AgMBAAECggEAA3YVx7TwUrYNp9T2oFe5GqbuBr3g/0at7cDM4JmOnJcq\niqxkDtUbVuNGCxcJy+hnKQGGkyVAnDajx8Qb3o0vdu44n/MsAzNBOTTz+TMXQq/j\nSsS72QAWkvlFUP424MCYsev9jlAvz7D37wDYajISyf8GRUulj5euNlt6I7uwwAbh\nDXVPm5OjCRdwNPVSh9idhnriI/ZCZMuQmI0U6QQ0JnVFGCM0jpRAt9nT3A8/eJoZ\n7zjBpNfovK02J63fJE8X/YoIMKO2E2AHHLdhvKLTb+D03h6mT6lypR9bJ9kFkLtq\nkGsH0QRctTBCxZUF6WY6+u7/x+RSP+m2q2K78DeUEQKBgQD9aAtFWHREBwdj91nK\nbTbdwZlP3eFUxNpG+d6n9m7Nt0CtzM/orSQzVdYEIcvA/96twVdsL3j/NJJ0qdiP\nBUlbtwT19pOU+bXD0lj35ELpIpGJvUofcHpAQ6p/CkEbraPwh+ZB3aHiLYkkJDcX\nBDJSIUP2UKd3vqn7ElBrUwKYswKBgQDnSnIhy0gYR0+6ngCii9XG2A+MXYq8f24d\ncmpctFs51WNdE+ft6vDvR/k3k5Mz9qxJlg98Py5kSjUu2t0JViHE4dCHz8opC1/H\nJBRrHBiEWvdAM6bbq8wz34mRvZzD33TUhgGuwzjCBPaL5Thqi7A+tMJJaEEO7w+X\nM8wC17OahQKBgQC4DwRwwAjjCH/zukv73kwF0oL7IdxzZ/BrsT5qnXJp9XsDQkqZ\nZHlw2B31Ll8CtlcVueM371thctwV5PApIdvgxBTUWt9jS+UccQKyO5fmIne3pkfa\ngiYp23xRfi9AXWVAZlV27faRhCWinLNvAltSkFr+5CJftZtdhDXpXof6RQKBgCso\nfBWMPh6xp9H1y76JA1IAXR5fEhVMXfrGr8wup1sqU0k5/qwpi93Ke1mAgxZOMCXn\nB2qyy3BRXI0qr9YfKVv4mxXMkzeHdM7PD7RQ4M5JvxtOyBLzgr4nNx9n10nBd6Z0\nfvniWcPycyL1mcpf2HpK9noGJyWnPCyFsMrS/yOVAoGACxzDM0egGnZN5he+tDkp\nuHRW++F9WVlVRHDrpsrvKEc5C2hokEF6z81qAdP2qB6uwFL2K/ba4TLJYnWewi+A\n6m42WE97IvLU83JyiWdOmBu3rps3qKYc9b+cxgZ90omgQZGpJBNVmi2d7lLvFCQC\nt3o0gT1Gclz8m0D94LOR6OE=\n-----END PRIVATE KEY-----\n").replace(/\\n/g, '\n');

async function testModel(modelId: string) {
  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const token = await auth.getAccessToken();
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/contentloop-dev/locations/us-central1/publishers/google/models/${modelId}:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt: 'a cat' }], parameters: { sampleCount: 1 } })
  });
  const data = await res.json();
  console.log(`[${modelId}]`, data.error ? data.error.message : 'Success');
}

(async () => {
  await testModel('imagen-3.0-fast-generate-001');
  await testModel('imagen-3.0-generate-001');
  await testModel('imagen-3.0-generate-002');
  await testModel('imagegeneration@006');
})();
