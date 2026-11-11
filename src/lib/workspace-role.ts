export function workspaceRoleLabel(role: string): "Owner / Buyer" | "Provider / Seller" {
  return role === "owner" ? "Owner / Buyer" : "Provider / Seller";
}
