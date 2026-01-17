const sharks = [
    {
        tag: "Tracking",
        name: "Deep Blue",
        description: "Is a female great white shark that is estimated to be 6.1m long or larger and is now 60 years old. She is believed to be one of the largest ever recorded in history.",
        length: "6.1m",
        weight: "2000kg",
        zone: "Pacific",
        img: "images/White_shark.jpg",

        coords: {top: "40%", left: "15%"}
    },
    {
        tag: "Tracking",
        name: "Ironbound",
        description: "A tough Great White named after West Ironbound Island. He travels thousands of miles.",
        length: "3.75m",
        weight: "539.32kg",
        zone:"North Atlantic",
        img: "images/Ironbound.jpg",

        coords: {top: "25%", left: "32%"}
    }
];

let currentSharkIndex = -1;

function nextShark() {
    currentSharkIndex = currentSharkIndex + 1;

    if (currentSharkIndex >= sharks.length) {
        currentSharkIndex = 0;
    }

    let shark = sharks[currentSharkIndex];

    document.getElementById("tag").innerText = shark.tag;
    document.getElementById("shark-name").innerText = shark.name;
    document.getElementById("shark-description").innerText = shark.description;
    document.getElementById("shark-length").innerText = shark.length;
    document.getElementById("shark-weight").innerText = shark.weight;
    document.getElementById("shark-zone").innerText = shark.zone;

    document.getElementById("shark-image").src = shark.img;

    let dot = document.getElementById("shark-dot");
    dot.style.top = shark.coords.top;
    dot.style.left = shark.coords.left;
}

nextShark();