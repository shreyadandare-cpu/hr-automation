import Posts, { SinglePost } from "./Posts.jsx";

export const routes = [{ path: "/app/posts", element: <Posts /> }, { path: "/app/posts/:id", element: <SinglePost /> }];
