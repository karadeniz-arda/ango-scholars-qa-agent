import fs from "node:fs";

export function writeReport(content: string) {
    fs.writeFileSync(
        "qa-results/report.md",
        content,
        "utf8"
    );
}