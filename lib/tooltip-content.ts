/**
 * Tooltip Content Dictionary
 * 
 * All tooltip texts written in simple, 7th-grade level language.
 * Keep explanations clear, short, and action-oriented.
 */

export const TOOLTIP_CONTENT: Record<string, string> = {
  // ===== Job Actions =====
  'job-edit': 'Click to change this job\'s details like date, time, or cleaner',
  'job-complete': 'Mark this job as finished',
  'job-undo': 'Change this job back to scheduled (un-complete it)',
  'job-delete': 'Remove this job completely',
  'job-cancel': 'Cancel this job so it won\'t happen',
  
  // ===== Job Status =====
  'job-scheduled': 'This job is planned and ready to go',
  'job-completed': 'This job is already done',
  'job-cancelled': 'This job was cancelled and won\'t happen',
  'job-one-time': 'This is a one-time job, not a regular cleaning',
  'job-recurring': 'This job happens regularly on a schedule',
  
  // ===== Add-On Actions =====
  'addon-edit': 'Change the price or name of this add-on service',
  'addon-delete': 'Remove this add-on service completely',
  
  // ===== Navigation =====
  'nav-dashboard': 'See your business overview and money stats',
  'nav-clients': 'View and manage all your customers',
  'nav-calendar': 'See all your cleaning jobs on a calendar',
  'nav-invoices': 'Create and manage bills you send to customers',
  'nav-subcontractors': 'Manage the cleaners who work for you',
  'nav-expenses': 'Track money you spend on your business',
  'nav-settings': 'Change how the app works and looks',
  
  // ===== Client Actions =====
  'client-edit': 'Change this customer\'s information',
  'client-delete': 'Remove this customer completely',
  'client-invoice': 'Create a bill for this customer',
  'client-add-job': 'Add a new cleaning job for this customer',
  'client-add-location': 'Add a new place to clean for this customer',
  'client-add-schedule': 'Set up regular cleanings for this customer',
  
  // ===== Schedule Actions =====
  'schedule-edit': 'Change when and how often cleanings happen',
  'schedule-delete': 'Stop this regular cleaning schedule',
  'schedule-reassign': 'Change which cleaner does this job',
  
  // ===== Invoice Actions =====
  'invoice-edit': 'Change what\'s on this bill',
  'invoice-delete': 'Remove this bill completely',
  'invoice-send': 'Email this bill to the customer',
  'invoice-mark-paid': 'Mark this bill as paid',
  'invoice-download': 'Download this bill as a PDF file',
  'invoice-preview': 'See what the bill will look like before sending',
  
  // ===== Subcontractor Actions =====
  'subcontractor-edit': 'Change this cleaner\'s information',
  'subcontractor-delete': 'Remove this cleaner completely',
  'subcontractor-pay': 'Record that you paid this cleaner',
  'subcontractor-assign': 'Give this job to this cleaner',
  
  // ===== Expense Actions =====
  'expense-edit': 'Change this expense\'s details',
  'expense-delete': 'Remove this expense completely',
  'expense-categorize': 'Put this expense in a category like supplies or equipment',
  
  // ===== Quick Actions =====
  'add-client': 'Add a new customer to your system',
  'add-job': 'Add a new cleaning job',
  'add-expense': 'Record money you spent',
  
  // ===== Form Actions =====
  'form-save': 'Save your changes',
  'form-cancel': 'Cancel and go back without saving',
  'form-delete': 'Delete this item permanently',
  'form-submit': 'Submit this form',
  'form-reset': 'Clear all your changes and start over',
  
  // ===== Status Indicators =====
  'status-online': 'The system is working properly',
  'status-offline': 'The system is having problems',
  'status-syncing': 'Syncing data with QuickBooks',
  'status-connected': 'Connected to QuickBooks',
  'status-disconnected': 'Not connected to QuickBooks',
  
  // ===== Settings =====
  'settings-save': 'Save your settings',
  'settings-reset': 'Reset everything back to default',
  'settings-export': 'Download all your data',
  'settings-backup': 'Create a backup of your data',
  
  // ===== QuickBooks =====
  'qb-connect': 'Connect your QuickBooks account',
  'qb-disconnect': 'Disconnect from QuickBooks',
  'qb-sync': 'Get your expenses from QuickBooks',
  'qb-reset-sync': 'Reset sync so you can import expenses again',
  
  // ===== Filters & Search =====
  'filter-apply': 'Show only items that match your filters',
  'filter-clear': 'Clear all filters and show everything',
  'search': 'Type to find what you\'re looking for',
  
  // ===== Calendar =====
  'calendar-today': 'Jump to today\'s date',
  'calendar-prev': 'Go to the previous month',
  'calendar-next': 'Go to the next month',
  'calendar-view-month': 'See the whole month',
  'calendar-view-week': 'See just this week',
  'calendar-view-day': 'See just today',
  
  // ===== Dashboard =====
  'dashboard-refresh': 'Update all the numbers with the latest data',
  'dashboard-export': 'Download this report',
  'dashboard-filter': 'Change what time period you\'re looking at',
  
  // ===== General =====
  'help': 'Get help and learn how to use this',
  'close': 'Close this window',
  'back': 'Go back to the previous page',
  'more': 'See more options',
  'less': 'See fewer options',
  'expand': 'Show more details',
  'collapse': 'Hide details',
  'select-all': 'Select everything',
  'deselect-all': 'Unselect everything',
  'bulk-action': 'Do this action to all selected items',
  
  // ===== Billing & Payment Types =====
  'billing-flat-rate': 'You charge the same amount every month, like $500/month. Good for customers who want predictable bills',
  'billing-per-clean': 'You charge for each cleaning job separately. Good when jobs happen at different times',
  'cleaner-pay-flat-rate': 'You pay the cleaner the same amount every month, like $300/month. Good for regular cleaners',
  'cleaner-pay-per-clean': 'You pay the cleaner for each job they do. Good when different cleaners do different jobs',
  'payment-terms': 'How many days the customer has to pay. Net 7 = 7 days, Net 30 = 30 days',
  'payment-terms-due-on-receipt': 'Customer must pay as soon as they get the bill',
  'payment-terms-net-7': 'Customer has 7 days to pay after getting the bill',
  'payment-terms-net-30': 'Customer has 30 days to pay after getting the bill',
  
  // ===== Schedule & Frequency =====
  'frequency-weekly': 'Cleaning happens once every week on the same day',
  'frequency-bi-weekly': 'Cleaning happens every 2 weeks (twice a month)',
  'frequency-monthly': 'Cleaning happens once every month',
  'frequency-every-3-weeks': 'Cleaning happens every 3 weeks',
  'frequency-every-4-weeks': 'Cleaning happens every 4 weeks',
  'frequency-every-6-weeks': 'Cleaning happens every 6 weeks',
  'frequency-custom': 'Set up a one-time job or custom schedule',
  'days-of-week': 'Pick which days of the week the cleaning happens (like Monday and Wednesday)',
  'time-specific': 'Pick an exact time, like 9:00 AM. The cleaner should arrive at this time',
  'time-window': 'Pick a time range, like 9:00 AM to 11:00 AM. The cleaner can come anytime in this window',
  'schedule-start-date': 'When this schedule starts creating jobs. Jobs will be made starting from this date',
  'schedule-end-date': 'When this schedule stops creating jobs. Leave blank if it never ends',
  'schedule-active': 'Turn this schedule on or off. When off, no new jobs will be created',
  
  // ===== Rates & Pricing =====
  'client-rate': 'How much money you charge the customer for this cleaning',
  'subcontractor-rate': 'How much money you pay the cleaner for doing this job',
  'profit-margin': 'The percentage of money you keep after paying the cleaner. Higher is better',
  'avg-monthly-revenue': 'The average amount of money you make from this customer each month',
  'avg-monthly-profit': 'The average amount of money you keep after paying cleaners each month',
  'selected-period-revenue': 'The actual amount of money you made in the time period you selected',
  'selected-period-profit': 'The actual amount of money you kept in the time period you selected',
  
  // ===== Client Fields =====
  'client-name': 'The name of your customer or their business',
  'client-phone': 'The customer\'s phone number',
  'client-email': 'The customer\'s email address for regular communication',
  'client-invoicing-email': 'The email address where you send bills. Can be different from their regular email',
  'client-notes': 'Put gate codes, access instructions, special notes, or anything else you need to remember here',
  'client-billing-type': 'How you charge this customer: Flat Rate = same amount every month, Per Clean = charge for each job',
  'client-cleaner-pay-type': 'How you pay cleaners for this customer: Monthly Flat = same amount each month, Per Clean = pay for each job',
  'client-start-date': 'When you started working with this customer',
  
  // ===== Location Fields =====
  'location-name': 'A name for this place, like "Main Office" or "Downtown Location"',
  'location-address': 'The full street address where the cleaning happens',
  'location-access-info': 'Gate codes, key locations, entry instructions, or anything the cleaner needs to know to get in',
  
  // ===== Invoice Fields =====
  'invoice-date-range': 'Pick which cleaning jobs to include on this bill. Jobs in this date range will be added',
  'invoice-date-due': 'The date when the customer needs to pay this bill',
  'invoice-notes': 'Any special notes or payment instructions to include on the bill',
  'invoice-status-draft': 'This bill is not finished yet. You can still change it',
  'invoice-status-sent': 'This bill has been sent to the customer',
  'invoice-status-paid': 'The customer has paid this bill',
  'invoice-line-item': 'Each cleaning job or service listed on the bill',
  
  // ===== Subcontractor Fields =====
  'subcontractor-name': 'The cleaner\'s name',
  'subcontractor-phone': 'The cleaner\'s phone number',
  'subcontractor-email': 'The cleaner\'s email address',
  'subcontractor-notes': 'Any notes about this cleaner',
  'subcontractor-balance': 'How much money you still owe this cleaner for completed jobs',
  'subcontractor-payment-history': 'See all the times you\'ve paid this cleaner',
  
  // ===== Expense Fields =====
  'expense-date': 'When you spent this money',
  'expense-amount': 'How much money you spent',
  'expense-description': 'What you spent money on',
  'expense-category': 'What type of expense this is (supplies, equipment, etc.)',
  'expense-type-fixed': 'This expense happens regularly, like rent or insurance',
  'expense-type-variable': 'This expense changes based on how much work you do',
  'expense-vendor': 'Who you bought this from',
  'expense-receipt': 'Upload a picture of the receipt',
  
  // ===== Dashboard KPIs =====
  'kpi-total-revenue': 'All the money you\'ve made from customers',
  'kpi-total-cleaner-payout': 'All the money you\'ve paid to cleaners',
  'kpi-total-profit': 'The money you keep after paying cleaners (Revenue minus Payout)',
  'kpi-profit-margin': 'The percentage of money you keep. Higher is better for your business',
  'kpi-avg-monthly': 'The average amount per month based on regular schedules',
  'kpi-selected-period': 'The actual amount for the time period you picked',
  
  // ===== Table & List Actions =====
  'table-sort': 'Click to sort the list by this column',
  'table-filter': 'Click to filter the list',
  'table-select': 'Click to select this item',
  'table-expand': 'Click to see more details about this item',
  'list-refresh': 'Update the list with the latest information',
  'list-export': 'Download this list as a file',
  
  // ===== Add-On Services =====
  'addon-description': 'What this add-on service is, like "Window Cleaning" or "Fridge Deep Clean"',
  'addon-frequency': 'How often this add-on happens (weekly, monthly, every 6 weeks, etc.)',
  'addon-client-rate': 'How much you charge the customer for this add-on',
  'addon-cleaner-rate': 'How much you pay the cleaner for this add-on',
  'addon-recurring': 'This add-on happens automatically on a schedule',
  'addon-one-time': 'This add-on is for a single job only',
  
  // ===== Job Details =====
  'job-date': 'When this cleaning job is scheduled to happen',
  'job-time': 'What time the cleaning job happens',
  'job-location': 'Where this cleaning job takes place',
  'job-cleaner': 'Which cleaner is assigned to do this job',
  'job-status': 'Whether this job is scheduled, completed, or cancelled',
  'job-invoiced': 'Whether this job has been added to a bill yet',
  'job-paid': 'Whether you\'ve paid the cleaner for this job yet',
  
  // ===== Quick Actions =====
  'quick-assign': 'Quickly assign a cleaner to this job',
  'quick-complete': 'Quickly mark this job as finished',
  'quick-invoice': 'Create a bill quickly for one customer',
  'quick-pay': 'Quickly record a payment to a cleaner',
  
  // ===== Batch Operations =====
  'batch-select': 'Select multiple items to do the same action to all of them',
  'batch-invoice': 'Create bills for multiple customers at once',
  'batch-pay': 'Record payments for multiple cleaners at the same time',
  'batch-categorize': 'Put multiple expenses in the same category at once',
  
  // ===== Settings & Configuration =====
  'settings-business-name': 'Your business name (will appear on bills)',
  'settings-business-address': 'Your business address (will appear on bills)',
  'settings-business-phone': 'Your business phone number',
  'settings-business-email': 'Your business email address',
  'settings-default-payment-terms': 'The default number of days customers have to pay (you can change this for each bill)',
  'settings-auto-generate-invoices': 'Automatically create bills at the end of each month',
  'settings-email-notifications': 'Get email alerts about important things',
  'settings-sms-notifications': 'Get text message alerts',
  
  // ===== Calendar Actions =====
  'calendar-add-job': 'Add a new cleaning job on this date',
  'calendar-view-job': 'See details about this job',
  'calendar-edit-job': 'Change this job\'s details',
  'calendar-assign-cleaner': 'Assign a cleaner to this job',
  
  // ===== Status & Indicators =====
  'status-active': 'This is currently active and working',
  'status-inactive': 'This is turned off and not working',
  'status-pending': 'This is waiting to happen',
  'status-overdue': 'This is past due and needs attention',
  'status-upcoming': 'This is coming up soon',
  
  // ===== Help & Guidance =====
  'help-billing-types': 'Flat Rate = charge the same every month. Per Clean = charge for each job. Choose based on what works for the customer',
  'help-cleaner-pay-types': 'Monthly Flat = pay the same every month. Per Clean = pay for each job. Choose based on your agreement with the cleaner',
  'help-schedule-frequency': 'Pick how often cleaning happens. Weekly = every week, Monthly = once a month, etc.',
  'help-time-window': 'A time window lets the cleaner come anytime between two times. Good when exact time doesn\'t matter',
  'help-add-ons': 'Add-ons are extra services like window cleaning or deep cleaning that happen in addition to regular cleaning',
  'help-invoicing': 'Create bills to send to customers. Pick which jobs to include and the bill will be made automatically',
  'help-payments': 'Record when you pay cleaners so you can track how much you owe',
  'help-expenses': 'Track money you spend on supplies, equipment, and other business costs',
  
  // ===== Empty States =====
  'empty-clients': 'You don\'t have any customers yet. Click "Add Client" to get started',
  'empty-jobs': 'No jobs scheduled. Add a schedule to a customer\'s location to create jobs',
  'empty-invoices': 'No bills created yet. Create your first bill from the Invoices page',
  'empty-subcontractors': 'No cleaners added yet. Click "Add Cleaner" to add your first cleaner and start tracking payments',
  'empty-expenses': 'No expenses recorded yet. Add expenses to track your business costs',
  'empty-locations': 'This customer doesn\'t have any locations yet. Click "Add Location" to add one',
  'empty-schedules': 'This location doesn\'t have any schedules yet. Click "Add Schedule" to set up regular cleanings',
  'empty-add-ons': 'No add-on services yet. Click to add extra services like window cleaning',
  
  // Accounting Export
  'accounting-export-generate': 'Generate and download financial reports for your accountant. Choose what to export and the date range.',
  
  // ===== Validation & Errors =====
  'error-required': 'This field is required. Please fill it in',
  'error-invalid-email': 'Please enter a valid email address',
  'error-invalid-phone': 'Please enter a valid phone number',
  'error-invalid-date': 'Please enter a valid date',
  'error-invalid-amount': 'Please enter a valid amount (numbers only)',
  'error-date-past': 'This date is in the past. Please pick a future date',
  'error-date-range': 'The end date must be after the start date',
  
  // ===== Success Messages =====
  'success-client-created': 'Customer created! Now add a location and schedule to start generating jobs',
  'success-schedule-created': 'Schedule created! Jobs have been automatically generated for the next 3 months',
  'success-job-created': 'Job created! It will appear on your calendar',
  'success-invoice-created': 'Bill created! You can now send it to the customer',
  'success-payment-recorded': 'Payment recorded! The balance has been updated',
  
  // ===== Advanced Features =====
  'advanced-options': 'Show more advanced options and settings',
  'apply-to-future': 'Apply this change to all future jobs in this schedule',
  'regenerate-jobs': 'Create new jobs for this schedule (useful if you changed the schedule)',
  'export-data': 'Download all your data as a file for backup',
  'import-data': 'Load data from a backup file',
}

/**
 * Get tooltip content by key
 * Falls back to the key itself if not found (for development)
 */
export function getTooltipContent(key: string): string {
  return TOOLTIP_CONTENT[key] || key
}

/**
 * Check if a tooltip key exists
 */
export function hasTooltipContent(key: string): boolean {
  return key in TOOLTIP_CONTENT
}

