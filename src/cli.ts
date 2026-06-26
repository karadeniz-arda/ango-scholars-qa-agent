import "dotenv/config";
import { loadFixture } from "./jira/load-fixture.js";
import { generateTestPlan } from "./planner/plan-from-fixture.js";
import { runApiCases } from "./agents/api/run-api-cases.js";

const args = process.argv.slice(2);
const command = args[0]; // Terminalden gelen ilk kelime ('plan' veya 'run')
const fixtureIndex = args.indexOf("--fixture");

if (fixtureIndex === -1) {
  console.error("Missing --fixture argument");
  process.exit(1);
}

const fixtureId = args[fixtureIndex + 1]!;

(async () => {
  try {
    const ticket = loadFixture(fixtureId);
    console.log(`Bilet Okundu -> ${ticket.issue.key}: ${ticket.issue.summary}`);

    if (command === "plan") {
      // Sadece plan oluşturmak istersek
      await generateTestPlan(fixtureId);
    } else if (command === "run") {
      // Testleri çalıştırmak istersek
      console.log("Run komutu algılandı, API testleri ateşleniyor...");
      await runApiCases();
    } else {
      console.log("Geçersiz komut. Lütfen 'npm run plan' veya 'npm run run' kullanın.");
    }
  } catch (error) {
    console.error("Bir hata oluştu la:", error);
  }
})();