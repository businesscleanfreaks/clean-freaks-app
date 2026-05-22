# V1 Testing Checklist

This checklist is the working tracker for the remaining tester feedback. Mark
`Done?` only after the corresponding app or data change is ready for manual
testing.

| Done? | Priority | Area | What needs to change | Where / Screen |
| --- | --- | --- | --- | --- |
| [x] | High | Data | When you click Skip a Clean, there is no clear/easy way to undo that action or bring the clean back. That is a problem because our virtual assistant might make a mistake and click that button so we need to easily be able to put it back. | Job Detail Popup when you click on a job card |
| [ ] | High | Flow | Vendors Page updated to be like JSX. | Vendors Page |
| [ ] | High | Design | Job Detail Window updated to be like V5 JSX. | Job Detail Popup when you click on a job card |
| [ ] | High | Design | Add Job Flow updated to be like JSX. | Add Job button at top right of calendar |
| [ ] | High | Design | Add Client Flow updated to be like JSX. | Add Client button on Clients Page |
| [x] | High | Bug | When you check or uncheck a cleaner's job to say you paid it, then undo it to say you did not, there is an error and it does not let you do that. | Cleaners pay checkboxes |
| [ ] | Medium | Design | There should be an easy way to toggle to a different month on the calendar. | Calendar |
| [ ] | Low | Bug | If you click the arrow to go to a different month or week, the arrow position changes. Arrow locations should remain stable for quick navigation. | Calendar |
| [ ] | Medium | Design | Calendar actions and Job Detail Window actions need undo functionality so mistakes can be reverted. | Calendar and Job Detail Popup |
| [ ] | High | Design | Update client page to match the supplied design for real-world use cases. | Client Page |
| [ ] | Low | Design | Dashboard clients should be hoverable/clickable and open their client profile. | Dashboard |
| [ ] | Low | Design | Dashboard clients should be sortable alphabetically. | Dashboard |
| [x] | High | Data | SRU Studios client schedule is once a month. Cleaner pay shows two cleans for Maggie and the owed amount is incorrect. | Cleaners Pay |
| [x] | High | Data | Interior Doors shows cleaner pay as if the schedule is weekly instead of biweekly. This is structural. | Cleaners Pay |
| [x] | High | Data | Sam Darring account in cleaner pay has the same cadence problem. | Cleaners Pay |
| [x] | High | Data | The Burbank Dance Academy clean on May 18 is missing in the app. | Calendar / Job Data |
