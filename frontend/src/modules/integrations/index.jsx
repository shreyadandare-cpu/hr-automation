import { lazy } from "react";
/* Manage > Slack and Teams: company news posted to chat channels (loads only when opened). */
const ChatChannels = lazy(() => import("./ChatChannels.jsx"));

export const routes = [{ path: "/app/chat-channels", element: <ChatChannels /> }];
