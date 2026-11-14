from .models import Relationship, Source, TraceResult

DEMO_CLAIM = "The UN said we only had 12 years to stop climate change."

DEMO_SOURCES = [
    Source(
        id="demo-ipcc", publisher="IPCC", domain="ipcc.ch", kind="Primary evidence",
        title="Global Warming of 1.5°C — Summary for Policymakers",
        url="https://www.ipcc.ch/site/assets/uploads/sites/2/2022/06/SR15_Full_Report_LR.pdf", published="2018-10-08",
        date_basis="Public release date of the special report",
        excerpt="Global warming is likely to reach 1.5°C between 2030 and 2052 if it continues to increase at the current rate.",
        excerpt_type="Verified quotation", stance="Adds context",
        wording="Conditional projection: 1.5°C between 2030 and 2052",
        interpretation="The report gives a range conditional on the rate of warming. Its mitigation pathways describe what emissions cuts by 2030 could achieve.",
    ),
    Source(
        id="demo-guardian", publisher="The Guardian", domain="theguardian.com", kind="Reporting",
        title="We have 12 years to limit climate change catastrophe, warns UN",
        url="https://www.theguardian.com/environment/2018/oct/08/global-warming-must-not-exceed-15c-warns-landmark-un-report",
        published="2018-10-08", date_basis="First published 02:00 UTC (October 7, 9 p.m. EDT)",
        excerpt="We have 12 years to limit climate change catastrophe, warns UN",
        excerpt_type="Verified quotation", stance="Repeats claim",
        wording="A headline turns the near-term target into a 12-year window",
        interpretation="The article ties a 12-year window to limiting warming to 1.5°C. The headline compresses the report's conditional projection into a countdown.",
    ),
    Source(
        id="demo-release", publisher="IPCC", domain="ipcc.ch", kind="Press release",
        title="Summary for Policymakers of IPCC Special Report on Global Warming of 1.5°C approved by governments",
        url="https://www.ipcc.ch/site/assets/uploads/sites/2/2019/05/pr_181008_P48_spm_en.pdf",
        published="2018-10-08", date_basis="Publisher's press release date",
        excerpt="Global net human-caused emissions of carbon dioxide (CO₂) would need to fall by about 45 percent from 2010 levels by 2030",
        excerpt_type="Verified quotation", stance="Adds context",
        wording="An emissions milestone: about 45% below 2010 levels by 2030",
        interpretation="The IPCC's release presents 2030 as a benchmark in an emissions pathway toward net zero around 2050.",
    ),
    Source(
        id="demo-unep", publisher="UN Environment Programme", domain="unep.org", kind="Press release",
        title="Rapid and unprecedented action required to stay within 1.5ºC says UN’s Intergovernmental Panel on Climate Change",
        url="https://www.unep.org/en/news-and-stories/press-release/rapid-and-unprecedented-action-required-stay-within-15oc-says-uns",
        published="2018-10-08", date_basis="Dateline in the UNEP release",
        excerpt="To stay within 1.5°C, global net CO2 emissions caused by human activity should decline by about 45% from 2010 levels by 2030",
        excerpt_type="Verified quotation", stance="Adds context",
        wording="The UN release preserves the target and its conditions",
        interpretation="UNEP describes the 2030 emissions cuts within a pathway to 1.5°C and explains how impacts differ across warming levels.",
    ),
    Source(
        id="demo-factcheck", publisher="FactCheck.org", domain="factcheck.org", kind="Fact check",
        title="FactChecking Round Two of the Democratic Debate",
        url="https://www.factcheck.org/2019/06/factchecking-round-two-of-the-democratic-debate/",
        published="2019-06-28", date_basis="Publisher date and timestamp",
        excerpt="The 12-year figure is frequently mentioned by the press and politicians, and is extrapolated from a 2018 special report",
        excerpt_type="Verified quotation", stance="Contradicts",
        wording="A fact check identifies the deadline as an extrapolation",
        interpretation="The fact check contrasts debate claims of irreparable damage in 12 years with the report's conditional warming range and emissions pathway.",
    ),
]

DEMO = TraceResult(
    mode="demo", claim=DEMO_CLAIM, verdict="Overstated",
    summary="The IPCC set out pathways that cut CO₂ emissions about 45% by 2030 to limit warming to 1.5°C. Headlines turned that milestone into a 12-year countdown. The report projected a conditional range of 2030–2052 for reaching 1.5°C, and the later fact check found that the fixed deadline overstated the science.",
    citations=["demo-ipcc", "demo-guardian", "demo-factcheck"], earliest_id="demo-ipcc",
    original_id="demo-ipcc", sources=DEMO_SOURCES, retrieval="Verified demo cache",
    evidence_cutoff="2026-11-14",
    warnings=["Four sources share the earliest recorded date. Their within-day order is uncertain."],
    relationships=[
        Relationship(source="demo-guardian", target="demo-ipcc", proof="The article explicitly attributes its findings to the October 2018 IPCC report."),
        Relationship(source="demo-unep", target="demo-ipcc", proof="UNEP links to and summarizes the special report."),
        Relationship(source="demo-release", target="demo-ipcc", proof="The IPCC release names the Summary for Policymakers and announces its approval."),
        Relationship(source="demo-factcheck", target="demo-ipcc", proof="The fact check cites the Summary for Policymakers in its text and source list."),
        Relationship(source="demo-factcheck", target="demo-guardian", proof="The fact check links directly to the Guardian article as an example of press coverage."),
    ],
)
