/* Which mail plan a work email is on. Everyone is on Starter, except the senior posts (directors and the Vice President), who are on Business. */
export const mailPlanOf = (title) => (/\b(director|vice president)\b/i.test(title || "") ? "Business" : "Starter");
