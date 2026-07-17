import { getIdTokenForPersona } from "../src/auth/firebase.js";

getIdTokenForPersona("company_admin")
  .then((token) => {
    process.stdout.write(token);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
