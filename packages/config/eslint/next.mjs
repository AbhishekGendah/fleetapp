import nextConfig from "eslint-config-next";
import prettier from "eslint-config-prettier";

import { standards } from "./standards.mjs";

export default [...nextConfig, prettier, ...standards];
