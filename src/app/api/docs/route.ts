import { NextResponse } from "next/server";
import { openApiSpec } from "./openapi";

export async function GET() {
  return NextResponse.json(openApiSpec);
}
