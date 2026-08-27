-- -----------------------------------------------------------------------
-- Adds a dedicated unit_number column to customer_addresses so the address
-- book form can split Singapore-style addressing (street/building address
-- vs. an optional "#11-03" unit number) into two fields instead of asking
-- the customer to fold the unit number into the free-text address, which
-- was easy to omit or mis-place. Nullable — plenty of addresses (landed
-- property) have no unit number at all.
-- -----------------------------------------------------------------------
alter table customer_addresses add column unit_number text;
