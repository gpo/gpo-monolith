import http from 'k6/http';
import { check, fail } from 'k6';

export const options = {
  scenarios: {
    ramping: {
      // Ramp the arrival rate through the stages below to find where latency degrades
      executor: 'ramping-arrival-rate',
      startRate: 1,           // start at 1 request per second (RPS)
      timeUnit: '1s',          // rates are iterations per second
      preAllocatedVUs: 200,     // initial pool of VUs (adjust if necessary)
      maxVUs: 1000,             // maximum VUs available during ramp-up
      stages: [
        { target: 16, duration: '2m' },
        { target: 24, duration: '2m' },
        { target: 32, duration: '2m' },
        { target: 48, duration: '2m' },
        { target: 64, duration: '2m' },
      ],
    },
  },
  thresholds: {
    // Ensure that 95% of requests complete under 1 second.
    // This threshold will be flagged if exceeded.
    http_req_duration: ['p(95)<1000'],
  },
};

const urls = [
  'https://gpo.ca',
  'https://gpo.ca/find-candidate',
  'https://secure.gpo.ca/civicrm/contribute/transact?reset=1&id=202&riding=47&source=NC.W.DON.HR.Candidate_47',
];

export default function () {
  // Pick one of the 3 URLs at random to ensure equal distribution.
  const url = urls[Math.floor(Math.random() * urls.length)];
  const res = http.get(url);

  // Check that the response status is 200.
  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // Immediately stop the test if the response time goes above 1.5 seconds.
  if (res.timings.duration > 1500) {
    fail(`Response time exceeded threshold: ${res.timings.duration}ms`);
  }
}
