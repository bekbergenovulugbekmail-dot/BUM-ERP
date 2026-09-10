import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth uchun /api/auth/* marshrutlari
auth.addHttpRoutes(http);

export default http;
