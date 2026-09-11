/** CRM jadvallari bitta joyda — import faylida nomlar to'qnashmasligi uchun (`leads`, `activities` va h.k.). */
import {
  activities,
  customerSegmentMembers,
  customerSegments,
  distributionRoutes,
  leads,
  routeCustomers,
  routeVisits,
  salesReps,
} from "../db/schema/crm.js";

export const crmTables = {
  salesReps,
  leads,
  activities,
  customerSegments,
  customerSegmentMembers,
  distributionRoutes,
  routeCustomers,
  routeVisits,
};
