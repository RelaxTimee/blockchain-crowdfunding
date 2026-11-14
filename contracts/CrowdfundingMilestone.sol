// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract CrowdfundingMilestone {
    uint public campaignCount;
    uint public constant approvalPercent = 50;

    enum MilestoneStatus { Pending, Requested, Released }

    struct Campaign {
        uint campaignId;
        address creator;
        string name;
        uint goal;
        uint deadline;
        uint totalRaised;
        uint totalReleased;
        uint totalRefunded;
        uint releasedCount;
    }

    struct Milestone {
        string description;
        uint percent;
        string evidence;
        uint approvalWeight;
        uint amountReleased;
        MilestoneStatus status;
    }

    mapping(uint => Campaign) private campaigns;
    mapping(uint => Milestone[]) private milestones;
    mapping(uint => mapping(address => uint)) public contributions;
    mapping(uint => mapping(uint => mapping(address => bool))) public hasVoted;

    event CampaignCreated(uint indexed campaignId, address indexed creator, uint goal, uint deadline);
    event Contributed(uint indexed campaignId, address indexed backer, uint amount);
    event MilestoneRequested(uint indexed campaignId, uint indexed milestoneIndex, string evidence);
    event MilestoneApproved(uint indexed campaignId, uint indexed milestoneIndex, address indexed backer, uint weight);
    event FundsReleased(uint indexed campaignId, uint indexed milestoneIndex, address indexed to, uint amount);
    event Refunded(uint indexed campaignId, address indexed backer, uint amount);

    modifier campaignExists(uint _campaignId) {
        require(campaigns[_campaignId].creator != address(0), "Campaign not found");
        _;
    }

    function createCampaign(
        string memory _name,
        uint _goal,
        uint _durationMinutes,
        string[] memory _milestoneDescs,
        uint[] memory _milestonePercents
    ) public {
        require(bytes(_name).length > 0, "Name required");
        require(_goal > 0, "Goal must be greater than 0");
        require(_durationMinutes > 0, "Duration must be greater than 0");
        require(_milestoneDescs.length > 0, "Need at least 1 milestone");
        require(_milestoneDescs.length <= 10, "Too many milestones");
        require(_milestoneDescs.length == _milestonePercents.length, "Milestone data mismatch");

        campaignCount += 1;

        Campaign storage c = campaigns[campaignCount];
        c.campaignId = campaignCount;
        c.creator = msg.sender;
        c.name = _name;
        c.goal = _goal;
        c.deadline = block.timestamp + _durationMinutes * 1 minutes;

        uint totalPercent = 0;
        for (uint i = 0; i < _milestoneDescs.length; i++) {
            require(_milestonePercents[i] > 0, "Percent must be greater than 0");
            totalPercent += _milestonePercents[i];

            Milestone storage m = milestones[campaignCount].push();
            m.description = _milestoneDescs[i];
            m.percent = _milestonePercents[i];
        }
        require(totalPercent == 100, "Total percent must be 100");

        emit CampaignCreated(campaignCount, msg.sender, _goal, c.deadline);
    }

    // ===== Contribute Funds =====
    function contribute(uint _campaignId) public payable campaignExists(_campaignId) {
        Campaign storage c = campaigns[_campaignId];

        require(msg.sender != c.creator, "Creator cannot contribute");
        require(block.timestamp <= c.deadline, "Funding ended");
        require(msg.value > 0, "Amount must be greater than 0");

        contributions[_campaignId][msg.sender] += msg.value;
        c.totalRaised += msg.value;

        emit Contributed(_campaignId, msg.sender, msg.value);
    }

    // ===== Request Fund Release =====
    function requestRelease(uint _campaignId, uint _index, string memory _evidence)
        public
        campaignExists(_campaignId)
    {
        Campaign storage c = campaigns[_campaignId];

        require(msg.sender == c.creator, "Only creator");
        require(block.timestamp > c.deadline, "Funding not ended");
        require(c.totalRaised >= c.goal, "Goal not reached");
        require(_index < milestones[_campaignId].length, "Invalid milestone");

        Milestone storage m = milestones[_campaignId][_index];

        require(m.status != MilestoneStatus.Released, "Already released");
        require(m.status == MilestoneStatus.Pending, "Already requested");
        require(_index == c.releasedCount, "Wrong milestone order");
        require(bytes(_evidence).length > 0, "Evidence required");

        m.evidence = _evidence;
        m.status = MilestoneStatus.Requested;

        emit MilestoneRequested(_campaignId, _index, _evidence);
    }

    // ===== Approve Milestone =====
    function approveMilestone(uint _campaignId, uint _index) public campaignExists(_campaignId) {
        Campaign storage c = campaigns[_campaignId];

        require(_index < milestones[_campaignId].length, "Invalid milestone");

        Milestone storage m = milestones[_campaignId][_index];
        uint weight = contributions[_campaignId][msg.sender];

        require(weight > 0, "Only contributor");
        require(m.status == MilestoneStatus.Requested, "Milestone not requested");
        require(!hasVoted[_campaignId][_index][msg.sender], "Already voted");

        hasVoted[_campaignId][_index][msg.sender] = true;
        m.approvalWeight += weight;

        emit MilestoneApproved(_campaignId, _index, msg.sender, weight);

        if (m.approvalWeight * 100 > c.totalRaised * approvalPercent) {
            releaseMilestone(_campaignId, _index);
        }
    }

    // จ่ายเงินให้เจ้าของโครงการ 
    function releaseMilestone(uint _campaignId, uint _index) internal {
        Campaign storage c = campaigns[_campaignId];
        Milestone storage m = milestones[_campaignId][_index];

        uint amount;
        if (_index == milestones[_campaignId].length - 1) {
            amount = c.totalRaised - c.totalReleased;
        } else {
            amount = c.totalRaised * m.percent / 100;
        }
        require(c.totalReleased + amount <= c.totalRaised, "Exceeds raised funds");

        // เปลี่ยนสถานะก่อนโอนเงิน กันจ่ายซ้ำ
        m.status = MilestoneStatus.Released;
        m.amountReleased = amount;
        c.totalReleased += amount;
        c.releasedCount += 1;

        sendETH(c.creator, amount);

        emit FundsReleased(_campaignId, _index, c.creator, amount);
    }

    // ===== Refund Contribution =====
    function refund(uint _campaignId) public campaignExists(_campaignId) {
        Campaign storage c = campaigns[_campaignId];

        require(block.timestamp > c.deadline, "Funding not ended");
        require(c.totalRaised < c.goal, "Goal reached");

        uint amount = contributions[_campaignId][msg.sender];
        require(amount > 0, "No contribution");

        contributions[_campaignId][msg.sender] = 0;
        c.totalRefunded += amount;

        sendETH(msg.sender, amount);

        emit Refunded(_campaignId, msg.sender, amount);
    }

    function sendETH(address _to, uint _amount) internal {
        (bool sent, ) = payable(_to).call{value: _amount}("");
        require(sent, "ETH transfer failed");
    }

    function getProgress(uint _campaignId)
        public
        view
        campaignExists(_campaignId)
        returns (uint raised, uint goal, uint percent, uint timeLeft, bool goalReached)
    {
        Campaign storage c = campaigns[_campaignId];

        raised = c.totalRaised;
        goal = c.goal;
        percent = c.totalRaised * 100 / c.goal;
        timeLeft = block.timestamp < c.deadline ? c.deadline - block.timestamp : 0;
        goalReached = c.totalRaised >= c.goal;
    }

    function getCampaign(uint _campaignId)
        public
        view
        campaignExists(_campaignId)
        returns (Campaign memory)
    {
        return campaigns[_campaignId];
    }

    function getMilestones(uint _campaignId)
        public
        view
        campaignExists(_campaignId)
        returns (Milestone[] memory)
    {
        return milestones[_campaignId];
    }

    function getMilestone(uint _campaignId, uint _index)
        public
        view
        campaignExists(_campaignId)
        returns (Milestone memory)
    {
        require(_index < milestones[_campaignId].length, "Invalid milestone");
        return milestones[_campaignId][_index];
    }

    function getContribution(uint _campaignId, address _backer) public view returns (uint) {
        return contributions[_campaignId][_backer];
    }

    function getContractBalance() public view returns (uint) {
        return address(this).balance;
    }
}