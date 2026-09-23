import { createEntity, localAuth } from '@/api/localClient';

// User has both entity methods (list, filter, get, create, update, delete)
// and auth methods (me, updateMyUserData, logout)
export const User = { ...createEntity('users'), ...localAuth };

export const Farm = createEntity('farms');
export const Plot = createEntity('plots');
export const Seeding = createEntity('seedings');
export const Harvest = createEntity('harvests');
export const Activity = createEntity('activities');
export const ActivityType = createEntity('activity_types');
export const Spraying = createEntity('sprayings');
export const Employee = createEntity('employees');
export const EmployeeLog = createEntity('employee_logs');
export const ManpowerCompany = createEntity('manpower_companies');
export const Vehicle = createEntity('vehicles');
export const VehicleTreatment = createEntity('vehicle_treatments');
export const Pesticide = createEntity('pesticides');
export const Variety = createEntity('varieties');
export const Crop = createEntity('crops');
export const PlasticSheet = createEntity('plastic_sheets');
export const SheetType = createEntity('sheet_types');
export const Packaging = createEntity('packaging');
export const PalletType = createEntity('pallet_types');
export const Product = createEntity('products');
export const Customer = createEntity('customers');
export const CustomerProductPricing = createEntity('customer_product_pricing');
export const WeighingCertificate = createEntity('weighing_certificates');
export const WeighingItem = createEntity('weighing_items');
export const PlotSeeding = createEntity('plot_seedings');
export const CompanySettings = createEntity('company_settings');
export const Subscription = createEntity('subscriptions');
export const Payment = createEntity('payments');
export const Expense = createEntity('expenses');
export const InputType = createEntity('input_types');
export const Query = createEntity('query');
export const EmployeeEvent = createEntity('employee_events');
export const Supplier = createEntity('suppliers');
export const Invoice = createEntity('invoices');
// Time-clock attendance (synced from the JB-Clock bridge, see farmflow_sync.py)
export const ClockWorker = createEntity('clock_workers');
export const AttendanceRecord = createEntity('attendance_records');
// Temporary labour booked by the day from a manpower contractor — entered by hand,
// not synced from the clock (see components/attendance/TempWorkersTab.jsx).
export const TempWorkerGroup = createEntity('temp_worker_groups');
