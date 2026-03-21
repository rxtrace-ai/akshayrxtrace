import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { sendWelcomeEmail } from '@/lib/auth/welcome';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, fullName } = await req.json();

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return apiJson(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    await sendWelcomeEmail(email, fullName || 'there');

    return apiJson({
      success: true,
      message: 'Welcome email sent successfully',
    });
  } catch (error: any) {
    console.error('Send welcome email error:', error);
    return apiJson(
      { error: error?.message || 'Failed to send welcome email' },
      { status: 500 }
    );
  }
}

