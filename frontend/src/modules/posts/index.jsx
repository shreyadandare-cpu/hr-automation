import { lazy } from "react";
/* Each page loads only when it is first opened (code splitting), so the app starts fast. */
const Posts = lazy(() => import("./Posts.jsx"));
const SinglePost = lazy(() => import("./Posts.jsx").then((m) => ({ default: m.SinglePost })));

export const routes = [{ path: "/app/posts", element: <Posts /> }, { path: "/app/posts/:id", element: <SinglePost /> }];
