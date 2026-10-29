import nextConfig from "eslint-config-next";
import prettier from "eslint-config-prettier";

import { appStandards, standards } from "./standards.mjs";

export default [...nextConfig, prettier, ...standards, ...appStandards];
