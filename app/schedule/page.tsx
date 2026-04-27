import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { prisma } from "@/lib/db"
import { formatDate, formatCurrency } from "@/lib/utils"
import { addDays } from "date-fns"

// Force dynamic rendering to avoid connection pool issues during build
export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getUpcomingJobs() {
  const now = new Date()
  const thirtyDaysLater = addDays(now, 30)

  const jobs = await prisma.job.findMany({
    where: {
      date: {
        gte: now,
        lte: thirtyDaysLater,
      },
    },
    include: {
      location: {
        include: {
          client: true,
        },
      },
      subcontractor: true,
    },
    orderBy: {
      date: 'asc',
    },
  })

  return jobs
}

export default async function SchedulePage() {
  const jobs = await getUpcomingJobs()

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl sm:text-3xl font-bold text-primary mb-6 sm:mb-8">Schedule</h1>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Jobs (Next 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No jobs scheduled for the next 30 days.
            </p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">
                        {job.location.client.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {job.location.name} - {job.location.address}
                      </p>
                      <p className="text-sm mt-1">
                        <span className="font-medium">Subcontractor:</span>{' '}
                        {job.subcontractor?.name || (
                          <span className="text-orange-600">Unassigned</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatDate(job.date)}</p>
                      {job.startTime && (
                        <p className="text-sm text-muted-foreground">{job.startTime}</p>
                      )}
                      {job.startWindowBegin && job.startWindowEnd && (
                        <p className="text-sm text-muted-foreground">
                          {job.startWindowBegin} - {job.startWindowEnd}
                        </p>
                      )}
                      <p className="text-sm mt-1">
                        <span className="font-medium">Rate:</span> {formatCurrency(job.clientRate)}
                      </p>
                      <div className={`mt-2 inline-block px-2 py-1 rounded text-xs font-medium ${
                        job.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                        job.status === 'CANCELLED' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {job.status}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
