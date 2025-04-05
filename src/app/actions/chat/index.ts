"use server";

import { auth } from "@/app/lib/auth";
import db from "@/app/lib/prisma";
import { revalidatePath } from "next/cache";

type Role = "USER" | "ASSISTANT";

type SendMessageResult = {
  success: boolean;
  chat_session_id?: string;
  error?: string;
};

export async function sendMessageAction({
  chat_session_id,
  role,
  content,
}: {
  chat_session_id?: string;
  role: Role;
  content: string;
}): Promise<SendMessageResult> {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return {
        success: false,
        error: "Unauthorized: Please log in to continue",
      };
    }

    const userEmail = session.user.email;

    if (!chat_session_id) {
      const newChat = await db.chatSession.create({
        data: {
          title: "New Chat", // TODO: Dynamic title based on user input
          user_id: userEmail,
          messages: {
            create: {
              content,
              role,
              user_id: userEmail,
            },
          },
        },
      });

      revalidatePath("/chats");

      return {
        success: true,
        chat_session_id: newChat.id,
      };
    }

    // Verify chat session exists and belongs to user
    const chatSession = await db.chatSession.findUnique({
      where: {
        id: chat_session_id,
        user_id: userEmail,
      },
    });

    if (!chatSession) {
      return {
        success: false,
        error: "Chat session not found or unauthorized",
      };
    }

    // Add message to existing chat
    await db.chatSession.update({
      where: {
        id: chat_session_id,
      },
      data: {
        messages: {
          create: {
            content,
            role,
            user_id: userEmail,
          },
        },
      },
    });

    revalidatePath(`/chat/${chat_session_id}`);

    return {
      success: true,
      chat_session_id: chatSession.id,
    };
  } catch (error) {
    console.error("Error in sendMessageAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}
