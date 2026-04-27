-- CreateIndex
CREATE INDEX "jobs_date_idx" ON "jobs"("date");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_subcontractorId_idx" ON "jobs"("subcontractorId");

-- CreateIndex
CREATE INDEX "jobs_locationId_idx" ON "jobs"("locationId");

-- CreateIndex
CREATE INDEX "jobs_status_subcontractorId_idx" ON "jobs"("status", "subcontractorId");

-- CreateIndex
CREATE INDEX "jobs_status_invoiced_idx" ON "jobs"("status", "invoiced");

-- CreateIndex
CREATE INDEX "jobs_date_status_idx" ON "jobs"("date", "status");

-- CreateIndex
CREATE INDEX "invoices_dateCreated_idx" ON "invoices"("dateCreated");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_clientId_idx" ON "invoices"("clientId");

-- CreateIndex
CREATE INDEX "invoices_dateCreated_status_idx" ON "invoices"("dateCreated", "status");

-- CreateIndex
CREATE INDEX "subcontractor_payments_datePaid_idx" ON "subcontractor_payments"("datePaid");

-- CreateIndex
CREATE INDEX "subcontractor_payments_subcontractorId_idx" ON "subcontractor_payments"("subcontractorId");

-- CreateIndex
CREATE INDEX "subcontractor_payments_datePaid_subcontractorId_idx" ON "subcontractor_payments"("datePaid", "subcontractorId");

-- CreateIndex
CREATE INDEX "locations_clientId_idx" ON "locations"("clientId");

-- CreateIndex
CREATE INDEX "schedules_locationId_idx" ON "schedules"("locationId");

-- CreateIndex
CREATE INDEX "schedules_isActive_idx" ON "schedules"("isActive");

-- CreateIndex
CREATE INDEX "schedules_locationId_isActive_idx" ON "schedules"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "clients_isActive_idx" ON "clients"("isActive");

-- CreateIndex
CREATE INDEX "clients_billingType_idx" ON "clients"("billingType");


