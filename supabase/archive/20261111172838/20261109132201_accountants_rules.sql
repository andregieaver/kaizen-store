-- Accountants (B6, D512). The store's own books are an area of their own (`books:read`, `books:write`) where they were Settings' until now:
-- a role that could read Settings keeps reading the books. Changing them was the owner's alone and is now also a role's that grants it,
-- such as the Accountant's (offered to each store with the other starting roles), so no role is given that here.

UPDATE commerce.store_roles
   SET permissions = permissions || array['books:read']::text[], updated_at = now()
 WHERE 'settings:read' = ANY (permissions) AND NOT ('books:read' = ANY (permissions));
