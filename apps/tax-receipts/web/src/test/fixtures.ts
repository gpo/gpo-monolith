import type { Me } from '../api.js';

export const ME: Me = {
  id: 'u1',
  name: 'Terry Tester',
  email: 'terry@example.org',
  role: 'ADMIN',
  allRidings: true,
  ridingGrants: [],
  can: {
    issueReceipts: true,
    sendDonorPrechecks: true,
    administerKillSwitch: true,
    generateEntityReports: true,
    shareEntityReports: true,
    prepareRtdFilings: true,
    sendRtdFilings: true,
    fileEOForms: true,
  },
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
