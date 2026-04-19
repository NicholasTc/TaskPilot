import { NextRequest, NextResponse } from "next/server";
import { hashPassword, setAuthCookie, signAuthToken } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { UserModel } from "@/models/User";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    await connectToDatabase();
    const existingUser = await UserModel.findOne({ email }).lean();

    if (existingUser) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const createdUser = await UserModel.create({
      email,
      passwordHash,
    });

    const token = signAuthToken({
      userId: createdUser._id.toString(),
      email: createdUser.email,
    });

    await setAuthCookie(token);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/auth/signup failed", error);
    return NextResponse.json({ error: "Failed to sign up." }, { status: 500 });
  }
}
