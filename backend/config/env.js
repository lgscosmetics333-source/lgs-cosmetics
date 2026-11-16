import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// A developer's local file must never replace Hostinger's PORT or credentials.
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), override: false });
