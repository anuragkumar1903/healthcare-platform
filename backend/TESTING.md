# Backend Test Suite

Complete test coverage for the healthcare-platform backend.  
**Framework:** Jest (ESM, `--experimental-vm-modules`)  
**Test runner:** `npm test` (runs all) or individual scripts below.

---

## Quick Start

```bash
cd backend
npm install                  # installs socket.io-client + other devDeps
npm test                     # run all tests
npm run test:unit            # unit tests only
npm run test:integration     # integration tests only
npm run test:models          # model / schema tests
npm run test:security        # security tests
npm run test:socket          # Socket.io tests
```

---

## Test Structure

```
tests/
├── setup.js                          # MongoMemoryServer helpers
├── app.js                            # Minimal Express app for integration tests
├── pharmacyApp.js                    # Minimal pharmacy app (uses pgClient mock)
│
├── unit/
│   ├── authController.test.js        # registerUser, loginAuth, OTP, JWT, listUsers
│   ├── appointmentControl.test.js    # CRUD, stats, cancel, location, password verify
│   ├── getdetails.test.js            # searchdoctor (AI + fallback), getDoctors, stats
│   ├── middleware.test.js            # verifyToken, adminGuard
│   ├── pharmacy.medicine.test.js     # listMedicines, getMedicine, create/update/delete
│   ├── pharmacy.cart.order.test.js   # cart CRUD, placeOrder (ACID), adminUpdateOrderStatus
│   └── pharmacy.prescription.test.js # myPrescriptions, uploadPrescription, admin ops
│
├── integration/
│   ├── auth.routes.test.js           # Full HTTP: register, login, refresh, OTP flow
│   ├── appointment.routes.test.js    # Full HTTP: book, list, cancel, verify password
│   ├── doctor.routes.test.js         # Full HTTP: search, list, stats, /health
│   └── pharmacy.routes.test.js       # Full HTTP via pharmacyApp + pgClient mock
│
├── security/
│   └── security.test.js              # NoSQL injection, auth bypass, IDOR, HPP,
│                                     # XSS, role escalation, data leakage, rate-limit
│
├── socket/
│   └── socket.test.js                # Socket.io: appointment updates, WebRTC signaling,
│                                     # join-room auth, offer/answer/ICE, order rooms
│
└── models/
    └── models.test.js                # User, Doctor, Appointment, Contract schemas,
                                      # pre-save hooks, virtuals, validation, population
```

---

## Test Types & What They Cover

### Unit Tests
- All external dependencies mocked (`jest.unstable_mockModule` for ESM)
- Happy path + every error/validation branch
- No network, DB, or filesystem access

### Integration Tests  
- MongoDB in-memory server (`mongodb-memory-server`) — real Mongoose, no mocks
- Pharmacy routes use the hand-rolled `pgClient` mock
- Full HTTP request → response cycle via `supertest`
- Auth flows tested end-to-end (register → login → use token)

### Security Tests
| Attack | Tested |
|--------|--------|
| NoSQL Injection | `$gt`, `$ne`, `$where` in login/register body |
| Auth Bypass | 12 protected routes checked without token |
| JWT Tampering | Corrupted signature, wrong secret, expired token |
| Role Escalation | User/doctor tokens blocked from admin routes |
| IDOR | Cross-user ObjectId access returns 404/403 |
| HTTP Parameter Pollution | Duplicate query params (`role=user&role=admin`) |
| XSS Payload | `<script>` in request fields — not reflected unescaped |
| Sensitive Data Leakage | No bcrypt hash, OTP, or password in any response |
| Rate-Limit Headers | `RateLimit-Limit` header present on auth routes |
| Mass Assignment | `role=admin` in register body blocked by enum |

### Socket.io Tests
- Real `http.Server` + `socket.io` spun up in-process per test run
- Two clients connected simultaneously for WebRTC relay tests
- `socket.io-client` used for all client-side assertions

### Model Tests
- Real Mongoose against MongoMemoryServer
- Pre-save hooks: bcrypt hashing, `numericId` auto-increment, `doctorId` generation
- Enum enforcement, required fields, unique constraints
- Virtual fields (`publicProfile`)
- Populate relationships across collections

---

## Dependencies Added

```json
"devDependencies": {
  "socket.io-client": "^4.8.3"
}
```

All other dependencies (`jest`, `supertest`, `mongodb-memory-server`, `cross-env`) were already present.
