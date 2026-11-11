// Usage: npm run hash-pin -- 1234
// Prints a bcrypt hash you can paste into the staff.pin_hash column (or use the admin UI instead).
import bcrypt from "bcryptjs";
const pin = process.argv[2];
if (!pin) {
  console.error("Usage: npm run hash-pin -- <pin>");
  process.exit(1);
}
console.log(bcrypt.hashSync(String(pin), 10));
