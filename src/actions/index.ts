import { installErrorMap } from "@/forms/error-map";
import { admin } from "./admin";
import { answerHistory } from "./answer-history";
import { auth } from "./auth";
import { checkIn } from "./check-in";
import { course } from "./course";
import { exam } from "./exam";
import { gradeColumn } from "./grade-column";
import { grading } from "./grading";
import { gradingJob } from "./grading-job";
import { profile } from "./profile";
import { question } from "./question";
import { regrade } from "./regrade";
import { report } from "./report";
import { repository } from "./repository";
import { rollCall } from "./roll-call";
import { rubric } from "./rubric";

installErrorMap();

export const server = {
	auth,
	profile,
	admin,
	answerHistory,
	course,
	exam,
	gradeColumn,
	grading,
	gradingJob,
	question,
	regrade,
	report,
	repository,
	rollCall,
	rubric,
	checkIn,
};
