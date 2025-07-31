import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Parse request body
    const requestBody = await request.json();
    const { targetUserId, message = 'Test notification from web app' } = requestBody;

    if (!targetUserId) {
      return NextResponse.json({ 
        error: 'Missing targetUserId' 
      }, { status: 400 });
    }

    // Get target user profile
    const { data: targetProfile, error: targetError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', targetUserId)
      .single();

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }

    // Check if user can send notification to target user
    const canSendNotification = await checkNotificationPermission(userProfile, targetUserId);
    if (!canSendNotification) {
      return NextResponse.json({ 
        error: 'You are not authorized to send notifications to this user' 
      }, { status: 403 });
    }

    // Get target user's device tokens
    const { data: deviceTokens, error: tokensError } = await supabase
      .from('device_tokens')
      .select('*')
      .eq('user_id', targetUserId);

    if (tokensError) {
      console.error('Error fetching device tokens:', tokensError);
      return NextResponse.json({ error: 'Failed to fetch device tokens' }, { status: 500 });
    }

    if (!deviceTokens || deviceTokens.length === 0) {
      return NextResponse.json({ 
        error: 'No device tokens found for target user',
        message: 'User may not have the mobile app installed or notifications disabled',
        debug: {
          targetUserId,
          targetUserEmail: targetProfile.email,
          targetUserRole: targetProfile.role,
          currentUserRole: userProfile.role,
          currentUserId: userProfile.id
        }
      }, { status: 404 });
    }

    // Send test notification
    const title = `🧪 Test Bildirimi - ${userProfile.full_name}`;
    const body = message;

    const notificationResults = await Promise.allSettled(
      deviceTokens.map(token => sendPushNotification(token, title, body, {
        type: 'test',
        fromUserId: userProfile.id,
        fromUserName: userProfile.full_name,
        timestamp: new Date().toISOString(),
      }, 'test', 'high'))
    );

    // Count successful and failed notifications
    const successful = notificationResults.filter(result => result.status === 'fulfilled').length;
    const failed = notificationResults.filter(result => result.status === 'rejected').length;

    console.log(`🔔 [TEST] Sent ${successful}/${deviceTokens.length} test notifications to ${targetProfile.full_name}`);

    return NextResponse.json({
      success: true,
      message: `Test notification sent to ${successful} device(s)`,
      targetUser: {
        id: targetProfile.id,
        name: targetProfile.full_name,
        email: targetProfile.email,
        role: targetProfile.role
      },
      results: {
        total: deviceTokens.length,
        successful,
        failed,
        details: notificationResults.map((result, index) => ({
          device: deviceTokens[index]?.platform,
          token: deviceTokens[index]?.token?.substring(0, 20) + '...',
          success: result.status === 'fulfilled',
          error: result.status === 'rejected' ? (result as PromiseRejectedResult).reason : null
        }))
      }
    });

  } catch (error) {
    console.error('Error sending test notification:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

async function checkNotificationPermission(fromUser: any, toUserId: string): Promise<boolean> {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  
  // Coaches can send notifications to their assigned students
  if (fromUser.role === 'coach') {
    const { data: assignment } = await supabase
      .from('coach_student_assignments')
      .select('*')
      .eq('coach_id', fromUser.id)
      .eq('student_id', toUserId)
      .eq('is_active', true)
      .single();
    
    return !!assignment;
  }
  
  // Students can send notifications to their assigned coach
  if (fromUser.role === 'student') {
    const { data: assignment } = await supabase
      .from('coach_student_assignments')
      .select('*')
      .eq('student_id', fromUser.id)
      .eq('coach_id', toUserId)
      .eq('is_active', true)
      .single();
    
    return !!assignment;
  }
  
  return false;
}

async function sendPushNotification(
  token: any, 
  title: string, 
  body: string, 
  data?: Record<string, any>, 
  type?: string, 
  priority?: string
): Promise<any> {
  const message = {
    to: token.token,
    sound: 'default',
    title,
    body,
    data: {
      ...data,
      type,
      priority,
      timestamp: new Date().toISOString(),
    },
    priority: priority === 'high' ? 'high' : 'normal',
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Expo push service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Check if Expo returned any errors
    if (result.data && result.data.status === 'error') {
      throw new Error(`Expo push error: ${result.data.message}`);
    }

    return result;
  } catch (error) {
    console.error(`Error sending push notification to ${token.platform}:`, error);
    throw error;
  }
} 