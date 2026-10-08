# API CREATED

## AUTH AND USER 

`
#	Method	Endpoint	Access
1	POST	/api/v1/auth/register	Public
2	POST	/api/v1/auth/login	Public
3	POST	/api/v1/auth/logout	Auth
4	POST	/api/v1/auth/refresh-token	Public
5	POST	/api/v1/auth/change-password	Auth
6	POST	/api/v1/auth/forgot-password	Public
7	POST	/api/v1/auth/reset-password/:token	Public
8	GET	/api/v1/auth/me	Auth
9	GET	/api/v1/users	SuperAdmin, SalesManager
10	POST	/api/v1/users	SuperAdmin
11	GET	/api/v1/users/:id	SuperAdmin, SalesManager
12	PATCH	/api/v1/users/:id	SuperAdmin
13	DELETE	/api/v1/users/:id	SuperAdmin
14	PATCH	/api/v1/users/:id/status	SuperAdmin
15	PATCH	/api/v1/users/:id/role	SuperAdmin
16	PATCH	/api/v1/users/me/profile	Auth
`

## VEHICLE APIS

`
#	Method	Endpoint	Access	BRD Ref
1	GET	/api/v1/vehicles	Public	6.2
2	GET	/api/v1/vehicles/:slugOrId	Public	6.3
3	GET	/api/v1/vehicles/:id/similar	Public	6.3
4	GET	/api/v1/vehicles/stats/summary	Public/Admin	34.1
5	GET	/api/v1/vehicles/admin/all	Admin roles	9
6	POST	/api/v1/vehicles	SuperAdmin, InventoryMgr	10
7	PATCH	/api/v1/vehicles/:id	SuperAdmin, InventoryMgr	10
8	PATCH	/api/v1/vehicles/:id/status	SuperAdmin, InventoryMgr, SalesMgr	32
9	PATCH	/api/v1/vehicles/:id/sold	SuperAdmin, SalesMgr	31
10	PATCH	/api/v1/vehicles/:id/featured	SuperAdmin, InventoryMgr, MarketingMgr	10
11	DELETE	/api/v1/vehicles/:id	SuperAdmin, InventoryMgr	10

`

## LEAD APIS

`
#	Method	Endpoint	Access	BRD Ref
1	POST	/api/v1/leads/public	Public	13
2	GET	/api/v1/leads/stats/dashboard	CRM roles	9.1
3	GET	/api/v1/leads/stats/source-performance	SuperAdmin, SalesMgr, MktgMgr	15
4	GET	/api/v1/leads	CRM roles	9.2
5	POST	/api/v1/leads	SuperAdmin, SalesMgr, SalesExec	9.2
6	GET	/api/v1/leads/:id	SuperAdmin, SalesMgr, SalesExec	9.2
7	PATCH	/api/v1/leads/:id	SuperAdmin, SalesMgr, SalesExec	9.2
8	PATCH	/api/v1/leads/:id/status	SuperAdmin, SalesMgr, SalesExec	9.3
9	PATCH	/api/v1/leads/:id/assign	SuperAdmin, SalesMgr	9.2
10	PATCH	/api/v1/leads/:id/follow-up	SuperAdmin, SalesMgr, SalesExec	9.2
11	PATCH	/api/v1/leads/:id/priority	SuperAdmin, SalesMgr, SalesExec	9.1
12	PATCH	/api/v1/leads/:id/won	SuperAdmin, SalesMgr, SalesExec	9.3
13	PATCH	/api/v1/leads/:id/lost	SuperAdmin, SalesMgr, SalesExec	9.3
14	DELETE	/api/v1/leads/:id	SuperAdmin, SalesMgr	10
`

## LEAD ACTIVITY

`
#	Method	Endpoint	Access	BRD Ref
1	GET	/api/v1/lead-activities	CRM roles	9.2
2	POST	/api/v1/lead-activities	CRM roles	9.2
3	GET	/api/v1/lead-activities/:id	CRM roles	9.2
4	PATCH	/api/v1/lead-activities/:id	CRM roles	9.2
5	DELETE	/api/v1/lead-activities/:id	CRM roles	9.2
6	GET	/api/v1/lead-activities/lead/:leadId/timeline	CRM roles	9.2
7	GET	/api/v1/lead-activities/stats/summary	CRM roles	9.1

`

## COMPAIGN APIS

`#	Method	Endpoint	Access	BRD Ref
1	GET	/api/v1/campaigns/public/active	Public	28.1
2	GET	/api/v1/campaigns/public/:slug	Public	28.1
3	GET	/api/v1/campaigns/stats/summary	SuperAdmin, MarketingMgr, SalesMgr	15
4	GET	/api/v1/campaigns/:id/performance	SuperAdmin, MarketingMgr, SalesMgr	15
5	GET	/api/v1/campaigns	SuperAdmin, MarketingMgr, SalesMgr	15
6	POST	/api/v1/campaigns	SuperAdmin, MarketingMgr	28.2
7	GET	/api/v1/campaigns/:id	SuperAdmin, MarketingMgr, SalesMgr	15
8	PATCH	/api/v1/campaigns/:id	SuperAdmin, MarketingMgr	28.2
9	PATCH	/api/v1/campaigns/:id/status	SuperAdmin, MarketingMgr	28.2
10	PATCH	/api/v1/campaigns/:id/vehicles	SuperAdmin, MarketingMgr	28.2
11	DELETE	/api/v1/campaigns/:id	SuperAdmin, MarketingMgr	10

`

##  Appointment API 
`
#	Method	Endpoint	Access	BRD Ref
1	POST	/api/v1/appointments/public	Public	6.3
2	GET	/api/v1/appointments/stats/summary	CRM roles	9.1
3	GET	/api/v1/appointments	CRM roles	9.1
4	POST	/api/v1/appointments	CRM roles	9.1
5	GET	/api/v1/appointments/:id	CRM roles	9.1
6	PATCH	/api/v1/appointments/:id	CRM roles	9.1
7	PATCH	/api/v1/appointments/:id/assign	SuperAdmin, SalesMgr	9.2
8	PATCH	/api/v1/appointments/:id/status	CRM roles	9.1
9	PATCH	/api/v1/appointments/:id/reschedule	CRM roles	9.1
10	PATCH	/api/v1/appointments/:id/feedback	CRM roles	9.1
11	DELETE	/api/v1/appointments/:id	SuperAdmin, SalesMgr	10
`

## SALE APIS 

`
#	Method	Endpoint	Access	BRD Ref
1	GET	/api/v1/sales/stats/dashboard	CRM roles	34.2
2	GET	/api/v1/sales/stats/monthly?year=2025	CRM roles	34.2
3	GET	/api/v1/sales	CRM roles	31
4	POST	/api/v1/sales	CRM roles	31
5	GET	/api/v1/sales/:id	CRM roles	31
6	PATCH	/api/v1/sales/:id	SuperAdmin, SalesMgr	31
7	PATCH	/api/v1/sales/:id/payment	CRM roles	31
8	PATCH	/api/v1/sales/:id/delivery	CRM roles	31
9	POST	/api/v1/sales/:id/documents	CRM roles	31
10	DELETE	/api/v1/sales/:id/documents/:docId	CRM roles	31
11	DELETE	/api/v1/sales/:id	SuperAdmin	31

`

## Payment & Rerservation Combined

`
#	Method	Endpoint	Access	BRD Ref
1	POST	/api/v1/reservations/public	Public	8.1
2	GET	/api/v1/reservations/stats/summary	CRM roles	9.1
3	GET	/api/v1/reservations	CRM roles	8.1
4	GET	/api/v1/reservations/:id	CRM roles	8.1
5	PATCH	/api/v1/reservations/:id	CRM roles	8.1
6	PATCH	/api/v1/reservations/:id/assign	SuperAdmin, SalesMgr	9.2
7	PATCH	/api/v1/reservations/:id/confirm	CRM roles	8.1
8	PATCH	/api/v1/reservations/:id/extend	CRM roles	8.1
9	PATCH	/api/v1/reservations/:id/cancel	CRM roles	8.1
10	PATCH	/api/v1/reservations/:id/complete	SuperAdmin, SalesMgr	8.1
11	DELETE	/api/v1/reservations/:id	SuperAdmin, SalesMgr	10


#	Method	Endpoint	Access	BRD Ref
1	POST	/api/v1/payments/webhook/:gateway	Gateway (raw body)	8.2, 16.4
2	POST	/api/v1/payments/public/create-order	Public	8.1
3	POST	/api/v1/payments/public/verify	Public	8.1
4	GET	/api/v1/payments/stats/summary	SuperAdmin, SalesMgr, MktgMgr	15
5	GET	/api/v1/payments	CRM roles	8.2
6	GET	/api/v1/payments/:id	CRM roles	8.2
7	PATCH	/api/v1/payments/:id/refund	SuperAdmin, SalesMgr	8.2
`

## Notification 

`
#	Method	Endpoint	Access	BRD Ref
1	GET	/api/v1/notifications/me	Customer	27.1
2	PATCH	/api/v1/notifications/me/read-all	Customer	27.1
3	PATCH	/api/v1/notifications/me/:id/read	Customer	27.1
4	GET	/api/v1/notifications/stats/summary	SuperAdmin, SalesMgr, MktgMgr	9.1, 15
5	GET	/api/v1/notifications/inbox	CRM roles	9.1
6	PATCH	/api/v1/notifications/inbox/:id/read	CRM roles	9.1
7	GET	/api/v1/notifications	SuperAdmin, SalesMgr, MktgMgr	13
8	POST	/api/v1/notifications	SuperAdmin, SalesMgr, MktgMgr	13
9	POST	/api/v1/notifications/bulk	SuperAdmin, MktgMgr	13
10	GET	/api/v1/notifications/:id	SuperAdmin, SalesMgr, MktgMgr	13
11	PATCH	/api/v1/notifications/:id/retry	SuperAdmin, SalesMgr, MktgMgr	13
12	PATCH	/api/v1/notifications/:id/cancel	SuperAdmin, SalesMgr, MktgMgr	13
13	DELETE	/api/v1/notifications/:id	SuperAdmin	10
`

## ANALYTICS 
`
#	Method	Endpoint	Access	BRD Ref
1	GET	/api/v1/analytics/overview	All CRM roles	34.1
2	GET	/api/v1/analytics/follow-ups	SuperAdmin, SalesMgr, SalesExec	9.1
3	GET	/api/v1/analytics/sales	SuperAdmin, SalesMgr, SalesExec	34.2
4	GET	/api/v1/analytics/funnel	SuperAdmin, SalesMgr, SalesExec	15
5	GET	/api/v1/analytics/executives	SuperAdmin, SalesMgr	15
6	GET	/api/v1/analytics/leads	SuperAdmin, SalesMgr, MktgMgr	34.3
7	GET	/api/v1/analytics/sources	SuperAdmin, SalesMgr, MktgMgr	34.4, 11.2
8	GET	/api/v1/analytics/locations	SuperAdmin, SalesMgr, MktgMgr	12, 15
9	GET	/api/v1/analytics/price-bands	SuperAdmin, SalesMgr, MktgMgr, InventoryMgr	15
10	GET	/api/v1/analytics/km-bands	SuperAdmin, SalesMgr, MktgMgr, InventoryMgr	15
11	GET	/api/v1/analytics/inventory	SuperAdmin, SalesMgr, InventoryMgr, MktgMgr	15
12	GET	/api/v1/analytics/payments	SuperAdmin, SalesMgr, MktgMgr	15
13	GET	/api/v1/analytics/campaigns	SuperAdmin, MktgMgr, SalesMGR

`
